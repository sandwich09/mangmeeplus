// Audit B8: tasks that ask for a claim's approval were closed only by hand, so the task list kept
// showing claims long since approved, rejected or paid. These are the rules for closing them.

/** The templates whose tasks ask for a claim's approval. Tasks from any other rule are left alone. */
export const CLAIM_APPROVAL_TASK_TEMPLATE_KEYS = ['reimbursement_pending_approval', 'approval_sla_breach'];

const APPROVAL_DONE_STATUSES = ['APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID', 'PAID'];

/**
 * What becomes of an open approval task once its claim has this status: nothing while the claim
 * still waits for approval, DONE when the approval happened, CANCELED when it never will (rejected,
 * cancelled, withdrawn or reopened to draft, voided, or the claim is gone).
 */
export function claimApprovalTaskOutcome(claimStatus: string | undefined): 'DONE' | 'CANCELED' | null {
  if (claimStatus === 'PENDING_APPROVAL') return null;
  return claimStatus !== undefined && APPROVAL_DONE_STATUSES.includes(claimStatus) ? 'DONE' : 'CANCELED';
}

/** The claim an event is about: claim events carry it as their source, payment events in the payload. */
export function claimIdOfEvent(event: { eventType: string; sourceType: string; sourceId: string; payload: Record<string, unknown> }): string | undefined {
  if (!event.eventType.startsWith('reimbursement.')) return undefined;
  if (event.sourceType === 'reimbursement_request') return event.sourceId;
  const requestId = event.payload['requestId'];
  return typeof requestId === 'string' && requestId.length > 0 ? requestId : undefined;
}
