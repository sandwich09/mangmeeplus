import { lineUiLabel, lineDisplayDate, lineControlData, type LineReplyLanguage } from './line-language.logic';
import { TEAM_ACTION_LABELS } from '../../application/line-team-action.service';
import { scrubRecordText } from '@watchdog-bms/contracts';
import { EXPENSE_ACTION_LABELS, type ExpenseActionPreview } from '../../application/line-expense-action.service';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { formatThaiDate } from './line-draft-update-card.logic';
import { asCompleteLineCard } from './line-business-card.logic';

export function buildExpenseActionCard(preview: ExpenseActionPreview, reply?: string, language: LineReplyLanguage = preview.language ?? 'th'): LineReplyMessage {
  const r = preview.record;
  const team = Object.hasOwn(TEAM_ACTION_LABELS, preview.action);
  const actionLabel = lineUiLabel(EXPENSE_ACTION_LABELS[preview.action], language);
  const headline = language === 'en' ? (reply ? `Completed: ${actionLabel}.` : `Please review the details, then select ${actionLabel}.`) : reply ?? preview.summary;
  const lines = [headline, scrubRecordText(r.vendorName, 160), ...(!team ? [`${r.amount} ${r.currency === 'THB' ? language === 'en' ? 'THB' : 'บาท' : r.currency}`, lineDisplayDate(r.date, language)] : []), reply ? lineUiLabel(r.status, language) : `${lineUiLabel(r.status, language)} → ${lineUiLabel(r.nextStatus, language)}`,
    ...(preview.details ?? []).map(detail => lineUiLabel(detail, language)),
    ...(preview.reason ? [`${language === 'en' ? 'Reason' : 'เหตุผล'}: ${scrubRecordText(preview.reason, 200)}`] : [])];
  const buttons = (['expense_action_confirm', 'expense_action_cancel'] as const).map((action, i) => ({
    type: 'button', style: i === 0 ? 'primary' : 'secondary', action: { type: 'postback',
      label: i === 0 ? preview.evidenceReview ? lineUiLabel('ตรวจแล้ว ยืนยัน', language) : actionLabel : lineUiLabel('ไม่ทำ', language),
      data: language === 'en' ? lineControlData(new URLSearchParams({ action, token: preview.token }).toString(), language) : new URLSearchParams({ action, token: preview.token }).toString() },
  }));
  return asCompleteLineCard({ type: 'flex', altText: lines[0]!, canonicalText: lines.join('\n'), contents: { type: 'bubble',
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: lines.map((text, i) => ({ type: 'text', text, wrap: true, ...(i === 0 ? { weight: 'bold' } : {}) })) },
    ...(reply && (preview.certificates?.length || preview.offerWht || preview.offerPayment || preview.offerNext) ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      ...(preview.certificates ?? []).map(cert => ({ type: 'button', style: 'primary', action: { type: 'uri', label: lineUiLabel('ดู / ดาวน์โหลด 50 ทวิ', language), uri: cert.uri } })),
      ...(preview.offerNext ? [{ type: 'button', style: 'primary', action: { type: 'postback', label: lineUiLabel(EXPENSE_ACTION_LABELS[preview.offerNext], language), data: language === 'en' ? lineControlData(new URLSearchParams({ action: 'expense_action_next', token: preview.token }).toString(), language) : new URLSearchParams({ action: 'expense_action_next', token: preview.token }).toString() } }] : []),
      ...(preview.offerPayment ? [{ type: 'button', style: 'primary', action: { type: 'postback', label: lineUiLabel('บันทึกจ่าย', language), data: language === 'en' ? lineControlData(new URLSearchParams({ action: 'expense_action_payment', token: preview.token }).toString(), language) : new URLSearchParams({ action: 'expense_action_payment', token: preview.token }).toString() } }] : []),
      ...(preview.offerWht ? [{ type: 'button', style: 'primary', action: { type: 'postback', label: lineUiLabel('ออก 50 ทวิ', language), data: language === 'en' ? lineControlData(new URLSearchParams({ action: 'expense_action_wht', token: preview.token }).toString(), language) : new URLSearchParams({ action: 'expense_action_wht', token: preview.token }).toString() } }] : []),
    ] } } : {}),
    ...(!reply ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } } : {}),
  } });
}
