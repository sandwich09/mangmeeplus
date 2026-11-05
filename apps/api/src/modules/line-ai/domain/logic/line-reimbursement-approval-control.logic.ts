import { LINE_WORKFLOW_IDS, LINE_WORKFLOW_OPEN_ACTIONS, type LineWorkflowControl } from '@watchdog-bms/contracts';
import { lineControlData, type LineReplyLanguage } from './line-language.logic';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type ReimbursementApprovalOpenAction = 'expense_action_approve' | 'expense_action_reject' | 'expense_action_submit';
export function reimbursementApprovalOpenToken(secret: string, company: string, user: string, id: string, action: ReimbursementApprovalOpenAction): string {
  return `${id}.${createHmac('sha256', secret).update(JSON.stringify(['line-reimbursement-open-v1', company, user, id, action])).digest('base64url')}`;
}
export function verifyReimbursementApprovalOpenToken(secret: string, company: string, user: string, token: string, action: ReimbursementApprovalOpenAction): boolean {
  const expected = reimbursementApprovalOpenToken(secret, company, user, token.split('.')[0]!, action);
  return Boolean(secret) && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
export function reimbursementApprovalButtons(secret: string, company: string, user: string, id: string, language: LineReplyLanguage = 'th') {
  return (['expense_action_approve', 'expense_action_reject'] as const).map((action, i) => ({
    type: 'button', style: i === 0 ? 'primary' : 'secondary', action: { type: 'postback', label: language === 'en' ? i === 0 ? 'Approve' : 'Reject' : i === 0 ? 'อนุมัติ' : 'ไม่อนุมัติ',
      data: lineControlData(new URLSearchParams({ action, token: reimbursementApprovalOpenToken(secret, company, user, id, action) }).toString(), language) },
  }));
}

/** The complete payment intent is signed, including absent fields. */
export function lineWorkflowOpenSig(secret: string, company: string, user: string, act: string, id: string, pm = '', pd = '', pa = ''): string {
  if (!secret) throw new Error('LINE_WORKFLOW_SIGNER_UNAVAILABLE');
  return createHmac('sha256', secret)
    .update(JSON.stringify(['line-workflow-open-v1', company, user, act, id, pm, pd, pa])).digest('base64url');
}
export function verifyLineWorkflowOpenSig(secret: string, company: string, user: string, act: string, id: string, pm: string, pd: string, pa: string, sig: string): boolean {
  if (!secret || typeof sig !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(sig)) return false;
  const expected = lineWorkflowOpenSig(secret, company, user, act, id, pm, pd, pa);
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export function parseLineWorkflowControl(data: string | undefined): LineWorkflowControl | null {
  if (!data || data.length > 300) return null;
  const params = new URLSearchParams(data);
  const action = params.get('action');
  const exact = (required: string[], optional: string[] = []) => required.every(key => params.getAll(key).length === 1)
    && [...params.keys()].every(key => [...required, ...optional].includes(key) && params.getAll(key).length === 1);
  const value = (key: string) => params.get(key) ?? '';
  if (action === 'wf_open' && exact(['action', 'act', 'id', 'sig'], ['pm', 'pd', 'pa'])
    && LINE_WORKFLOW_OPEN_ACTIONS.some(act => act === value('act')) && /^[A-Za-z0-9_-]{1,128}$/u.test(value('id'))
    && /^[A-Za-z0-9_-]{43}$/u.test(value('sig'))
    && ['pm', 'pd', 'pa'].every(key => !params.has(key) || value(key).length > 0 && value(key).length <= 40)) {
    return { action, act: value('act') as typeof LINE_WORKFLOW_OPEN_ACTIONS[number], id: value('id'), sig: value('sig'),
      ...(params.has('pm') ? { pm: value('pm') } : {}), ...(params.has('pd') ? { pd: value('pd') } : {}),
      ...(params.has('pa') ? { pa: value('pa') } : {}) };
  }
  if (action === 'wf_choice' && exact(['action', 'token', 'pick']) && /^[A-Za-z0-9_-]{1,128}$/u.test(value('token'))
    && (value('pick') === 'other' || LINE_WORKFLOW_IDS.some(id => id === value('pick')))) {
    return { action, token: value('token'), pick: value('pick') as import('@watchdog-bms/contracts').LineWorkflowId | 'other' };
  }
  return null;
}


export function lineWorkflowOpenData(secret: string, company: string, user: string,
  act: Extract<LineWorkflowControl, { action: 'wf_open' }>['act'], id: string,
  payment: { pm?: string; pd?: string; pa?: string } = {}): string {
  return new URLSearchParams({ action: 'wf_open', act, id, ...payment,
    sig: lineWorkflowOpenSig(secret, company, user, act, id, payment.pm, payment.pd, payment.pa) }).toString();
}

export const CLAIM_WORKFLOW_ACTIONS = {
  reimbursement_submit: 'REIMBURSEMENT_SUBMIT', reimbursement_cancel: 'REIMBURSEMENT_CANCEL',
  approvals: 'REIMBURSEMENT_APPROVE', reimbursement_reject: 'REIMBURSEMENT_REJECT',
  reimbursement_pay: 'REIMBURSEMENT_RECORD_PAYMENT',
} as const;
export type ClaimWorkflowId = keyof typeof CLAIM_WORKFLOW_ACTIONS;


export function reimbursementPaymentButton(secret: string, company: string, user: string, id: string) {
  return { type: 'button', style: 'primary', action: { type: 'postback', label: 'บันทึกจ่ายคืน',
    data: lineWorkflowOpenData(secret, company, user, 'REIMBURSEMENT_RECORD_PAYMENT', id) } };
}


export const EXPENSE_WORKFLOW_ACTIONS = {
  expense_submit: 'MARK_READY', expense_confirm: 'CONFIRM', expense_delete: 'DELETE_DRAFT', expense_void: 'VOID',
  expense_pay: 'RECORD_PAYMENT', payment_voucher: 'VOUCHER_CREATE', wht_certificate: 'WHT_CERTIFICATE_ISSUE',
} as const;
export type ExpenseWorkflowId = keyof typeof EXPENSE_WORKFLOW_ACTIONS | 'substitute_receipt';
