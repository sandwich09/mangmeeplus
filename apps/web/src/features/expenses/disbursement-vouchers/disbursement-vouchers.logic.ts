import { disbursementReturnedApprover } from './disbursement-voucher-journey.logic';
import { disbursementCancelledPaymentSentence } from './disbursement-voucher-reissue.logic';
import { DISBURSEMENT_VOUCHER_STATUS_LABELS, DISBURSEMENT_VOUCHER_STATUS_TONES, disbursementVoucherPaymentAmount, coerceCivilDate, civilDateToUtcDate, todayCivilDate } from '@watchdog-bms/contracts';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
import { DISBURSEMENT_VOUCHER_BADGE_TONES, DISBURSEMENT_VOUCHER_FILTERS } from './disbursement-vouchers.constants';
import type { DisbursementVoucherDetail, DisbursementVoucherFilter, DisbursementVoucherListRow, DisbursementVoucherStatus } from './disbursement-vouchers.model';

export function disbursementVoucherDisplayAmount(detail: Pick<DisbursementVoucherDetail, 'header' | 'lines'>) {
  const original = detail.header.totalAmount;
  if (detail.header.status !== 'CANCELLED' || !detail.header.cancelledAfterPaid) return { amount: original, excludesCancelled: false };
  return disbursementVoucherPaymentAmount(original, detail.lines);
}

export function disbursementVoucherSummary(detail: { header: Pick<DisbursementVoucherDetail['header'], 'totalAmount'>; lines: Pick<DisbursementVoucherDetail['lines'][number], 'grandTotalAmount' | 'whtAmount'>[] }) {
  // Source document tax is informational even for a partial payout; never prorate or deduct it again.
  const sum = (values: string[]) => {
    const scaled = values.reduce((total, value) => {
      const [whole, fraction = ''] = value.split('.');
      return total + BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, '0'));
    }, 0n);
    return `${scaled / 10000n}.${String(scaled % 10000n).padStart(4, '0')}`;
  };
  return { gross: sum(detail.lines.map((line) => line.grandTotalAmount)),
    withholding: sum(detail.lines.map((line) => line.whtAmount)), payout: detail.header.totalAmount };
}

/** True when the amount of the document differs from "total less withholding": a partial line, or an expense partly paid before. */
/** Two money strings name the same amount (whatever their number of decimals). */
export const disbursementSameAmount = (a: string, b: string) => Number(a) === Number(b);
/** A line names what the expense still owes only when that says more than the line's own amount: an unpaid line whose balance differs, or a paid line that still owes. */
export const disbursementLineShowsOutstanding = (line: Pick<DisbursementVoucherDetail['lines'][number], 'amount' | 'outstandingAmount' | 'expensePaymentId'>) =>
  line.expensePaymentId ? Number(line.outstandingAmount) > 0 : !disbursementSameAmount(line.outstandingAmount, line.amount);
export function disbursementSummaryPartial(summary: { gross: string; withholding: string; payout: string }): boolean {
  const scaled = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, '0').slice(0, 4));
  };
  return scaled(summary.payout) !== scaled(summary.gross) - scaled(summary.withholding);
}

export function disbursementVoucherDraftActions(detail: Pick<DisbursementVoucherDetail, 'header' | 'actions'>) {
  return { edit: detail.header.status === 'DRAFT' && detail.actions.edit,
    delete: detail.header.status === 'DRAFT' && detail.actions.delete };
}

export function disbursementVoucherNextSentence(detail: DisbursementVoucherDetail, viewerUserId?: string | null): string | null {
  const words = workspaceDictionary.th;
  const { header, actions } = detail;
  switch (header.status) {
    case 'DRAFT': return disbursementReturnedApprover(detail, viewerUserId) ? words['expenses.disbursement.draft_next'] : actions.submitAndApprove ? words['expenses.disbursement.self_next'] : actions.submit ? words['expenses.disbursement.draft_next']
      : header.documentNumber ? detail.preparerName ? words['expenses.disbursement.draft_again_wait_preparer'].replace('{name}', detail.preparerName) : words['expenses.disbursement.draft_again_wait']
      : detail.preparerName ? words['expenses.disbursement.draft_wait_preparer'].replace('{name}', detail.preparerName) : words['expenses.disbursement.draft_wait'];
    case 'PENDING_APPROVAL': return actions.approve && viewerUserId && header.requestedApproverUserId && viewerUserId !== header.requestedApproverUserId && detail.requestedApproverName
      ? words['expenses.disbursement.wait_other_approver'].replace('{name}', detail.requestedApproverName) : actions.approve ? words['expenses.disbursement.approval_next'] : detail.requestedApproverName
      ? words['expenses.disbursement.wait_approver'].replace('{name}', detail.requestedApproverName)
      : words['expenses.disbursement.wait_any_approver'];
    case 'APPROVED': return actions.pay ? words['expenses.disbursement.pay_next'] : words['expenses.disbursement.wait_payment'];
    case 'PAID': return header.paidDate ? words['expenses.disbursement.paid_next'].replace('{date}', formatThaiDate(header.paidDate)) : null;
    case 'CANCELLED': {
      const decision = [...detail.revisions].reverse().find((revision) => revision.decision === 'CANCELLED');
      const at = header.cancelledAt ?? decision?.decidedAt;
      const reason = header.cancelReason ?? decision?.decisionReason;
      if (at && disbursementCancelledPaymentSentence(detail)) return words['expenses.disbursement.cancelled_date'].replace('{date}', formatThaiDate(at));
      return at && reason ? words['expenses.disbursement.cancelled_next']
        .replace('{date}', formatThaiDate(at)).replace('{reason}', reason) : null;
    }
  }
}

export function canPrepareDisbursementVoucher(permissions: readonly string[]): boolean {
  return permissions.includes('expense.disbursement.prepare');
}

export function disbursementVoucherBadge(status: DisbursementVoucherStatus) {
  return { label: DISBURSEMENT_VOUCHER_STATUS_LABELS[status], tone: DISBURSEMENT_VOUCHER_BADGE_TONES[DISBURSEMENT_VOUCHER_STATUS_TONES[status]] };
}

export function disbursementVoucherPrimaryLabel(row: Pick<DisbursementVoucherListRow, 'status' | 'primaryAction'>): string {
  const words = workspaceDictionary.th;
  if (row.status === 'PAID') return words['expenses.disbursement.view_paid'];
  const labels = {
    submit: 'expenses.disbursement.submit', approve: 'expenses.disbursement.approve',
    pay: 'expenses.disbursement.pay', view: 'expenses.disbursement.view',
  } as const;
  return words[labels[row.primaryAction]];
}

export function disbursementVoucherDateLine(row: Pick<DisbursementVoucherListRow, 'status' | 'plannedPayDate' | 'paidDate'>, now = new Date()): string | null {
  const words = workspaceDictionary.th;
  if (row.status === 'PAID') return row.paidDate ? words['expenses.disbursement.paid_on'].replace('{date}', formatThaiDate(row.paidDate)) : null;
  if (!row.plannedPayDate) return null;
  const planned = coerceCivilDate(row.plannedPayDate);
  const overdue = (civilDateToUtcDate(todayCivilDate('Asia/Bangkok', now)).getTime() - civilDateToUtcDate(planned).getTime()) / 86_400_000;
  return row.status !== 'CANCELLED' && overdue > 0
    ? words['expenses.disbursement.overdue'].replace('{n}', String(overdue))
    : words['expenses.disbursement.planned_on'].replace('{date}', formatThaiDate(planned));
}

export function disbursementVoucherListQuery(params: URLSearchParams): { filter: DisbursementVoucherFilter; page: number; q: string } {
  const value = params.get('status');
  const page = Number(params.get('page') ?? 1);
  return { filter: DISBURSEMENT_VOUCHER_FILTERS.find((filter) => filter === value) ?? 'all',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1, q: params.get('q')?.trim() ?? '' };
}
