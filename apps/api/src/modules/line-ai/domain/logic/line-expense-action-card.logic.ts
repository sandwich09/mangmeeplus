import { TEAM_ACTION_LABELS } from '../../application/line-team-action.service';
import { scrubRecordText } from '@watchdog-bms/contracts';
import { EXPENSE_ACTION_LABELS, type ExpenseActionPreview } from '../../application/line-expense-action.service';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { formatThaiDate } from './line-draft-update-card.logic';
import { asCompleteLineCard } from './line-business-card.logic';

export function buildExpenseActionCard(preview: ExpenseActionPreview, reply?: string): LineReplyMessage {
  const r = preview.record;
  const team = Object.hasOwn(TEAM_ACTION_LABELS, preview.action);
  const lines = [reply ?? preview.summary, scrubRecordText(r.vendorName, 160), ...(!team ? [`${r.amount} ${r.currency === 'THB' ? 'บาท' : r.currency}`, formatThaiDate(r.date)] : []), reply ? r.status : `${r.status} → ${r.nextStatus}`,
    ...(preview.details ?? []),
    ...(preview.reason ? [`เหตุผล: ${scrubRecordText(preview.reason, 200)}`] : [])];
  const buttons = (['expense_action_confirm', 'expense_action_cancel'] as const).map((action, i) => ({
    type: 'button', style: i === 0 ? 'primary' : 'secondary', action: { type: 'postback',
      label: i === 0 ? preview.evidenceReview ? 'ตรวจแล้ว ยืนยัน' : EXPENSE_ACTION_LABELS[preview.action] : 'ไม่ทำ',
      data: new URLSearchParams({ action, token: preview.token }).toString() },
  }));
  return asCompleteLineCard({ type: 'flex', altText: lines[0]!, canonicalText: lines.join('\n'), contents: { type: 'bubble',
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: lines.map((text, i) => ({ type: 'text', text, wrap: true, ...(i === 0 ? { weight: 'bold' } : {}) })) },
    ...(reply && (preview.certificates?.length || preview.offerWht || preview.offerPayment || preview.offerNext) ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      ...(preview.certificates ?? []).map(cert => ({ type: 'button', style: 'primary', action: { type: 'uri', label: 'ดู / ดาวน์โหลด 50 ทวิ', uri: cert.uri } })),
      ...(preview.offerNext ? [{ type: 'button', style: 'primary', action: { type: 'postback', label: EXPENSE_ACTION_LABELS[preview.offerNext], data: new URLSearchParams({ action: 'expense_action_next', token: preview.token }).toString() } }] : []),
      ...(preview.offerPayment ? [{ type: 'button', style: 'primary', action: { type: 'postback', label: 'บันทึกจ่าย', data: new URLSearchParams({ action: 'expense_action_payment', token: preview.token }).toString() } }] : []),
      ...(preview.offerWht ? [{ type: 'button', style: 'primary', action: { type: 'postback', label: 'ออก 50 ทวิ', data: new URLSearchParams({ action: 'expense_action_wht', token: preview.token }).toString() } }] : []),
    ] } } : {}),
    ...(!reply ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } } : {}),
  } });
}
