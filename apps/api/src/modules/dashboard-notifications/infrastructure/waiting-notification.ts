import { DISBURSEMENT_VOUCHER_STATUS_LABELS, REIMBURSEMENT_STATUS_LABELS } from '@watchdog-bms/contracts';
const ACTIONS: Record<string, string> = {
  'expense.disbursement_pending_approval': 'approve', 'expense.disbursement_approved': 'pay', 'expense.disbursement_returned': 'fix',
  'workflow.reimbursement_pending_approval': 'approve', 'workflow.approval_sla_breach': 'approve',
  'workflow.reimbursement_payout_correction_submitted': 'approve',
  'workflow.reimbursement_ready_for_payment': 'pay', 'workflow.reimbursement_payment_sla_breach': 'pay',
  'workflow.reimbursement_correction_requester': 'fix', 'workflow.reimbursement_payout_correction_requested': 'fix',
  'workflow.reimbursement_finance_review': 'review',
  'workflow.reimbursement_duplicate_cancel': 'duplicate', 'workflow.reimbursement_duplicate_confirmed': 'duplicate', 'workflow.reimbursement_duplicate_sla_breach': 'duplicate',
};
export function waitingNoticeKey(event: { triggerKey: string; sourceType: string; sourceId?: string | null; severity: string }): string | null {
  const action = ACTIONS[event.triggerKey];
  return action && event.sourceId && ['disbursement_voucher', 'reimbursement_request'].includes(event.sourceType) && ['action', 'critical'].includes(event.severity.toLowerCase())
    ? `${event.sourceType}:${event.sourceId}:${action}` : null;
}
export const WAITING_NOTICE_TRIGGERS = Object.keys(ACTIONS);
export function finishedNoticeTitle(title: string, state: string): string {
  return title.replace(/อนุมัติแล้ว รอจ่าย|รอคุณบันทึกจ่าย|รออนุมัติ|รอตรวจสอบการเงิน|รอจ่าย(?:เงิน)?|พร้อมจ่าย|ส่งกลับให้แก้|ตีกลับ|รอแก้ไข/g, state);
}
/** Web projection only: the stored sentence and LINE delivery remain unchanged. */
export async function documentStateWords(db: any, companyId: string, rows: any[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const [type, model, words] of [['disbursement_voucher', 'disbursementVoucher', DISBURSEMENT_VOUCHER_STATUS_LABELS], ['reimbursement_request', 'reimbursementRequest', REIMBURSEMENT_STATUS_LABELS]] as const) {
    const ids = rows.filter(row => row.sourceType === type && row.sourceId).map(row => row.sourceId);
    if (!ids.length) continue;
    for (const row of await db[model].findMany({ where: { companyId, id: { in: ids } }, select: { id: true, status: true } })) result.set(`${type}:${row.id}`, (words as Record<string, string>)[row.status] ?? 'ปิดแล้ว');
  }
  return result;
}
