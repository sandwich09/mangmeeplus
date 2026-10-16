import { createHmac, timingSafeEqual } from 'node:crypto';

export type ReimbursementApprovalOpenAction = 'expense_action_approve' | 'expense_action_reject' | 'expense_action_submit';
export function reimbursementApprovalOpenToken(secret: string, company: string, user: string, id: string, action: ReimbursementApprovalOpenAction): string {
  return `${id}.${createHmac('sha256', secret).update(JSON.stringify(['line-reimbursement-open-v1', company, user, id, action])).digest('base64url')}`;
}
export function verifyReimbursementApprovalOpenToken(secret: string, company: string, user: string, token: string, action: ReimbursementApprovalOpenAction): boolean {
  const expected = reimbursementApprovalOpenToken(secret, company, user, token.split('.')[0]!, action);
  return Boolean(secret) && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
export function reimbursementApprovalButtons(secret: string, company: string, user: string, id: string) {
  return (['expense_action_approve', 'expense_action_reject'] as const).map((action, i) => ({
    type: 'button', style: i === 0 ? 'primary' : 'secondary', action: { type: 'postback', label: i === 0 ? 'อนุมัติ' : 'ไม่อนุมัติ',
      data: new URLSearchParams({ action, token: reimbursementApprovalOpenToken(secret, company, user, id, action) }).toString() },
  }));
}
