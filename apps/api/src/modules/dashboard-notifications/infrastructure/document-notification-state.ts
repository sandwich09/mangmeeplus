import type { PrismaService } from '../../../common/database/prisma.service';

/** Conditions behind actionable alerts, independent of whether their recipients have read them. */
export const DOCUMENT_NOTIFICATION_STATES: Record<string, { sourceType: string; statuses: readonly string[] }> = {
  'expense.substitute_receipt_signature_pending': { sourceType: 'substitute_receipt_evidence', statuses: ['PREPARED'] },
  'expense.substitute_receipt_approval_pending': { sourceType: 'substitute_receipt_evidence', statuses: ['PAYER_CERTIFIED'] },
  'workflow.reimbursement_pending_approval': { sourceType: 'reimbursement_request', statuses: ['PENDING_APPROVAL'] },
  'workflow.approval_sla_breach': { sourceType: 'reimbursement_request', statuses: ['PENDING_APPROVAL'] },
  'workflow.reimbursement_correction_requester': { sourceType: 'reimbursement_request', statuses: ['DRAFT'] },
  'workflow.reimbursement_finance_review': { sourceType: 'reimbursement_request', statuses: ['FINANCE_REVIEW'] },
  'workflow.reimbursement_ready_for_payment': { sourceType: 'reimbursement_request', statuses: ['READY_FOR_PAYMENT', 'PARTIALLY_PAID'] },
};

/** Read projection also covers old alerts, without overwriting read/dismissed history. */
export async function completedDocumentNotificationIds(db: PrismaService['client'], companyId: string, userId: string) {
  const events = await db.notificationEvent.findMany({
    where: { companyId, status: 'OPEN', triggerKey: { in: Object.keys(DOCUMENT_NOTIFICATION_STATES) }, recipients: { some: { userId, dismissedAt: null } } },
    select: { id: true, triggerKey: true, sourceType: true, sourceId: true },
  });
  const sourceIds = (type: string) => events.filter(event => event.sourceType === type && event.sourceId).map(event => event.sourceId!);
  const certificates = sourceIds('substitute_receipt_evidence');
  const claims = sourceIds('reimbursement_request');
  const [certificateRows, claimRows] = await Promise.all([
    certificates.length ? db.expenseSubstituteReceiptEvidence.findMany({ where: { companyId, id: { in: certificates } }, select: { id: true, status: true } }) : [],
    claims.length ? db.reimbursementRequest.findMany({ where: { companyId, id: { in: claims } }, select: { id: true, status: true } }) : [],
  ]);
  return events.filter(event => {
    const rule = DOCUMENT_NOTIFICATION_STATES[event.triggerKey];
    if (!rule || event.sourceType !== rule.sourceType) return false;
    const row = (rule.sourceType === 'substitute_receipt_evidence' ? certificateRows : claimRows).find(row => row.id === event.sourceId);
    return !row || !rule.statuses.includes(row.status);
  }).map(event => event.id);
}

/**
 * The decision code words a claim event carries, in the words the claim page uses. Workflow notices
 * are rendered through this map when they are created, so the stored text (and the LINE push,
 * which sends the stored text as it is) never carries a code word (audit B15).
 */
export const REIMBURSEMENT_DECISION_WORDS: Record<string, string> = {
  APPROVED: 'อนุมัติ',
  REJECTED: 'ไม่อนุมัติ',
  BELOW_APPROVAL_THRESHOLD: 'ไม่ต้องอนุมัติตามนโยบาย',
  BLOCKED: 'ระงับ',
};
const DECISION_CODE_WORD = new RegExp(`\\b(${Object.keys(REIMBURSEMENT_DECISION_WORDS).join('|')})\\b`, 'g');

/** Read-time repair for notices stored before the words were rendered at creation. */
export function localizeReimbursementDecision(body: string): string {
  return body.replace(DECISION_CODE_WORD, (code) => REIMBURSEMENT_DECISION_WORDS[code]!);
}
