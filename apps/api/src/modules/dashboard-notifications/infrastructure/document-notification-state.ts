import { claimPaymentDuplicateBlock } from '../../reimbursements/domain/logic/reimbursement.logic';
import { effectivePolicy } from '../../reimbursements/domain/reimbursement.constants';
import { reimbursementPayoutCorrectionPhase, type ReimbursementPayoutCorrectionPhase } from '@watchdog-bms/contracts';
import type { PrismaService } from '../../../common/database/prisma.service';

/**
 * Conditions behind actionable alerts, independent of whether their recipients have read them.
 *
 * `payoutCorrection` is for claims: a claim sent back to have its payout account corrected (payout
 * spec §14) is PENDING_APPROVAL again, so its status alone would bring the approval notice of its
 * first round back to life while nobody can approve anything. It names where the claim must stand
 * for the notice to be still to do: in no round (`NONE`), or in one of a round's two phases. Left
 * out, the status decides alone. A claim whose cancellation is pending has nothing to do, whatever
 * its status.
 */
export const DOCUMENT_NOTIFICATION_STATES: Record<string, {
  sourceType: string; statuses: readonly string[]; actionOnly?: boolean; confirmedDuplicate?: boolean; payoutCorrection?: readonly ('NONE' | ReimbursementPayoutCorrectionPhase)[];
}> = {
  'expense.review_requested': { sourceType: 'expense_record', statuses: ['READY_FOR_CONFIRMATION'] },
  'expense.disbursement_returned': { sourceType: 'disbursement_voucher', statuses: ['DRAFT'], actionOnly: true },
  'expense.disbursement_pending_approval': { sourceType: 'disbursement_voucher', statuses: ['PENDING_APPROVAL'] },
  // Only actionable approval notices follow this state, including a preparer eligible to pay.
  'expense.disbursement_approved': { sourceType: 'disbursement_voucher', statuses: ['APPROVED'], actionOnly: true },
  'expense.substitute_receipt_signature_pending': { sourceType: 'substitute_receipt_evidence', statuses: ['PREPARED'] },
  'expense.substitute_receipt_approval_pending': { sourceType: 'substitute_receipt_evidence', statuses: ['PAYER_CERTIFIED'] },
  'workflow.reimbursement_pending_approval': { sourceType: 'reimbursement_request', statuses: ['PENDING_APPROVAL'], payoutCorrection: ['NONE'] },
  // The reminder also chases the approvers of a corrected account, never a claim that waits for its requester.
  'workflow.approval_sla_breach': { sourceType: 'reimbursement_request', statuses: ['PENDING_APPROVAL'], payoutCorrection: ['NONE', 'AWAITING_APPROVAL'] },
  'workflow.reimbursement_payout_correction_requested': { sourceType: 'reimbursement_request', statuses: ['PENDING_APPROVAL'], payoutCorrection: ['AWAITING_REQUESTER'] },
  'workflow.reimbursement_payout_correction_submitted': { sourceType: 'reimbursement_request', statuses: ['PENDING_APPROVAL'], payoutCorrection: ['AWAITING_APPROVAL'] },
  'workflow.reimbursement_correction_requester': { sourceType: 'reimbursement_request', statuses: ['DRAFT'] },
  'workflow.reimbursement_finance_review': { sourceType: 'reimbursement_request', statuses: ['FINANCE_REVIEW'] },
  'workflow.reimbursement_ready_for_payment': { sourceType: 'reimbursement_request', statuses: ['READY_FOR_PAYMENT', 'PARTIALLY_PAID'] },
  'workflow.reimbursement_duplicate_cancel': { sourceType: 'reimbursement_request', statuses: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT'], confirmedDuplicate: true },
  'workflow.reimbursement_duplicate_confirmed': { sourceType: 'reimbursement_request', statuses: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT'], confirmedDuplicate: true },
  'workflow.reimbursement_duplicate_sla_breach': { sourceType: 'reimbursement_request', statuses: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT'], confirmedDuplicate: true },
  'workflow.reimbursement_payment_sla_breach': { sourceType: 'reimbursement_request', statuses: ['READY_FOR_PAYMENT', 'PARTIALLY_PAID'] },
};

/** Read projection also covers old alerts, without overwriting read/dismissed history. */
export async function completedDocumentNotificationIds(db: PrismaService['client'], companyId: string, userId?: string, source?: { sourceType: string; sourceId: string; durable?: boolean }) {
  const events = await db.notificationEvent.findMany({
    where: { companyId, status: 'OPEN', triggerKey: { in: Object.keys(DOCUMENT_NOTIFICATION_STATES) }, ...(source && { sourceType: source.sourceType, sourceId: source.sourceId }), recipients: { some: { userId, dismissedAt: null } } },
    select: { id: true, triggerKey: true, severity: true, sourceType: true, sourceId: true, createdAt: true, sourceRefsJson: true },
  });
  const sourceIds = (type: string) => events.filter(event => event.sourceType === type && event.sourceId).map(event => event.sourceId!);
  const certificates = sourceIds('substitute_receipt_evidence');
  const claims = sourceIds('reimbursement_request');
  const vouchers = sourceIds('disbursement_voucher');
  const expenses = sourceIds('expense_record');
  const [certificateRows, claimRows, voucherRows, expenseRows] = await Promise.all([
    certificates.length ? db.expenseSubstituteReceiptEvidence.findMany({ where: { companyId, id: { in: certificates } }, select: { id: true, status: true } }) : [],
    claims.length ? db.reimbursementRequest.findMany({
      where: { companyId, id: { in: claims } },
      select: { id: true, status: true, payoutCorrectionRequestedAt: true, payoutCorrectionSubmittedAt: true, cancellationPendingAt: true, sourceExpenses: { where: { status: { notIn: ['VOIDED', 'REJECTED'] } }, select: { duplicateStatus: true } } },
    }) : [],
    vouchers.length ? db.disbursementVoucher.findMany({ where: { companyId, id: { in: vouchers } }, select: { id: true, status: true, revision: true } }) : [],
    expenses.length ? db.expenseRecord.findMany({ where: { companyId, id: { in: expenses } }, select: { id: true, status: true, submittedAt: true } }) : [],
  ]);
  return events.filter(event => {
    const rule = DOCUMENT_NOTIFICATION_STATES[event.triggerKey];
    if (!rule || event.sourceType !== rule.sourceType) return false;
    if (rule.actionOnly && event.severity !== 'ACTION') return false;
    if (rule.sourceType === 'expense_record') {
      const row = expenseRows.find(row => row.id === event.sourceId);
      const submittedAt = (event.sourceRefsJson as { refs?: { submittedAt?: string }[] } | null)?.refs?.[0]?.submittedAt;
      return !row || !rule.statuses.includes(row.status) || typeof submittedAt === 'string' && submittedAt !== row.submittedAt?.toISOString();
    }
    if (rule.sourceType === 'substitute_receipt_evidence') {
      const row = certificateRows.find(row => row.id === event.sourceId);
      return !row || !rule.statuses.includes(row.status);
    }
    if (rule.sourceType === 'disbursement_voucher') {
      const row = voucherRows.find(row => row.id === event.sourceId);
      // A resubmit starts a new task; the previous revision never becomes actionable again.
      const revision = (event.sourceRefsJson as { refs?: { revision?: number }[] } | null)?.refs?.[0]?.revision;
      return !row || !rule.statuses.includes(row.status) || typeof revision === 'number' && revision !== row.revision;
    }
    const claim = claimRows.find(row => row.id === event.sourceId);
    if (!claim || !rule.statuses.includes(claim.status)) return true;
    // A claim being cancelled takes no decision and no payment until that is finished or withdrawn: its
    // notices ask for something the API refuses. Read here, not stored, so a withdrawal gives them back.
    if (claim.cancellationPendingAt) return !source?.durable;
    if (rule.confirmedDuplicate && claimPaymentDuplicateBlock({ confirmedDuplicateExpenseCount: (claim.sourceExpenses ?? []).filter(expense => expense.duplicateStatus === 'CONFIRMED_DUPLICATE').length }, effectivePolicy(null)) !== 'CONFIRMED') return true;
    const phase = reimbursementPayoutCorrectionPhase(claim);
    if (rule.payoutCorrection && !rule.payoutCorrection.includes(phase ?? 'NONE')) return true;
    // A corrected account waits for approval since it was given: an approval notice from before that
    // moment is about the round before, and done.
    return phase === 'AWAITING_APPROVAL' && !!event.createdAt && !!claim.payoutCorrectionSubmittedAt
      && event.createdAt < claim.payoutCorrectionSubmittedAt;
  }).map(event => event.id);
}

/**
 * The decision code words a claim event carries, in the words the claim page uses. Workflow notices
 * are rendered through this map when they are created, so the stored text (and the LINE push,
 * which sends the stored text as it is) never carries a code word (audit B15).
 */
export const REIMBURSEMENT_DECISION_WORDS: Record<string, string> = {
  APPROVED: 'อนุมัติ',
  REJECTED: 'ส่งกลับให้แก้แล้ว',
  BELOW_APPROVAL_THRESHOLD: 'ไม่ต้องอนุมัติตามนโยบาย',
  BLOCKED: 'ระงับ',
};
const DECISION_CODE_WORD = new RegExp(`\\b(${Object.keys(REIMBURSEMENT_DECISION_WORDS).join('|')})\\b`, 'g');

/** Read-time repair for notices stored before the words were rendered at creation. */
export function localizeReimbursementDecision(body: string): string {
  return body.replace(DECISION_CODE_WORD, (code) => REIMBURSEMENT_DECISION_WORDS[code]!)
    .replace(/^ผลการพิจารณา: ไม่อนุมัติ(?= ·|$)/u, `ผลการพิจารณา: ${REIMBURSEMENT_DECISION_WORDS.REJECTED}`);
}

/** Same source-state rules as the read, called by the existing document notice/event step. */
export async function finishDocumentWaitingNotifications(db: PrismaService['client'], companyId: string, sourceType: string, sourceId: string, supersede = false) {
  if (!['disbursement_voucher', 'reimbursement_request'].includes(sourceType)) return;
  const completed = supersede
    ? (await db.notificationEvent.findMany({ where: { companyId, sourceType, sourceId, severity: { in: ['ACTION', 'CRITICAL'] }, triggerKey: { in: Object.keys(DOCUMENT_NOTIFICATION_STATES) } }, select: { id: true } })).map(row => row.id)
    : await completedDocumentNotificationIds(db, companyId, undefined, { sourceType, sourceId, durable: true });
  if (completed.length) await db.notificationRecipient.updateMany({
    where: { companyId, eventId: { in: completed }, waitingKey: { not: null }, finishedAt: null },
    data: { finishedAt: new Date() },
  });
}
