import { lineUiLabel, lineDisplayDate, lineControlData, type LineReplyLanguage } from './line-language.logic';
import { TEAM_ACTION_LABELS } from '../../application/line-team-action.service';
import { scrubRecordText } from '@watchdog-bms/contracts';
import { EXPENSE_ACTION_LABELS, type ExpenseActionPreview } from '../../application/line-expense-action.service';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { formatThaiDate } from './line-draft-update-card.logic';
import { asCompleteLineCard } from './line-business-card.logic';
import { drawLineSystemCard } from './line-system-card-limits.logic';
import { formatClaimMoney } from './line-reimbursement-draft-card.logic';
import type { LineSystemCardAction } from './line-system-card.logic';

export function buildExpenseActionCard(preview: ExpenseActionPreview, reply?: string, language: LineReplyLanguage = preview.language ?? 'th', webBaseUrl?: string): LineReplyMessage {
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
  const imageButton = preview.documentImageUrl ? [{ type: 'button', style: 'secondary', action: { type: 'uri', label: lineUiLabel('ส่งรูปเอกสาร', language), uri: preview.documentImageUrl } }] : [];
  const message = { type: 'flex', altText: lines[0]!, canonicalText: lines.join('\n'), contents: { type: 'bubble',
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: lines.map((text, i) => ({ type: 'text', text, wrap: true, ...(i === 0 ? { weight: 'bold' } : {}) })) },
    ...(reply && (preview.certificates?.length || preview.offerWht || preview.offerPayment || preview.offerNext || imageButton.length) ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      ...(preview.certificates ?? []).map(cert => ({ type: 'button', style: 'primary', action: { type: 'uri', label: lineUiLabel('ดู / ดาวน์โหลด 50 ทวิ', language), uri: cert.uri } })),
      ...(preview.offerNext ? [{ type: 'button', style: 'primary', action: { type: 'postback', label: lineUiLabel(EXPENSE_ACTION_LABELS[preview.offerNext], language), data: (preview.nextControls?.next ? lineControlData(preview.nextControls.next, language) : undefined) ?? (language === 'en' ? lineControlData(new URLSearchParams({ action: 'expense_action_next', token: preview.token }).toString(), language) : new URLSearchParams({ action: 'expense_action_next', token: preview.token }).toString()) } }] : []),
      ...(preview.offerPayment ? [{ type: 'button', style: 'primary', action: { type: 'postback', label: lineUiLabel('บันทึกจ่าย', language), data: (preview.nextControls?.payment ? lineControlData(preview.nextControls.payment, language) : undefined) ?? (language === 'en' ? lineControlData(new URLSearchParams({ action: 'expense_action_payment', token: preview.token }).toString(), language) : new URLSearchParams({ action: 'expense_action_payment', token: preview.token }).toString()) } }] : []),
      ...(preview.offerWht ? [{ type: 'button', style: 'primary', action: { type: 'postback', label: lineUiLabel('ออก 50 ทวิ', language), data: (preview.nextControls?.wht ? lineControlData(preview.nextControls.wht, language) : undefined) ?? (language === 'en' ? lineControlData(new URLSearchParams({ action: 'expense_action_wht', token: preview.token }).toString(), language) : new URLSearchParams({ action: 'expense_action_wht', token: preview.token }).toString()) } }] : []),
      ...imageButton,
    ] } } : {}),
    ...(!reply ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [...buttons, ...imageButton] } } : {}),
  } } as LineReplyMessage;
  const legacy = message as Extract<LineReplyMessage, { type: 'flex' }>;
  const en = language === 'en';
  const actions = ((legacy.contents as any).footer?.contents ?? []).map((entry: any) => entry.action as LineSystemCardAction);
  const contents = drawLineSystemCard({ mascot: 'general', header: { lines: en ? ['Expense', actionLabel] : ['ค่าใช้จ่าย', actionLabel] },
    rows: [
      { label: en ? 'Seller / payee' : 'ผู้ขาย / ผู้รับเงิน', value: scrubRecordText(r.vendorName, 160) },
      ...(!team ? [{ label: en ? 'Amount' : 'ยอดเงิน', value: formatClaimMoney(r.amount, r.currency, language), total: true },
        { label: en ? 'Date' : 'วันที่', value: r.date ? lineDisplayDate(r.date, language) : '' }] : []),
      { label: en ? 'Status' : 'สถานะ', value: reply ? lineUiLabel(r.status, language) : `${lineUiLabel(r.status, language)} → ${lineUiLabel(r.nextStatus, language)}` },
      ...(preview.reason?.trim() ? [{ label: en ? 'Reason' : 'เหตุผล', value: scrubRecordText(preview.reason, 200) }] : []),
    ].filter(row => row.value.trim() && row.value.trim() !== '-'),
    notes: [headline, ...(preview.details ?? []).map(detail => lineUiLabel(detail, language))].filter(Boolean),
    ...(!reply && actions.length === 2 ? { choice: actions as [LineSystemCardAction, LineSystemCardAction] }
      : actions.length ? { buttons: actions.map((action: LineSystemCardAction, index: number) => ({ action, icon: 'file' as const, primary: index === 0 })) } : {}),
  }, webBaseUrl);
  return asCompleteLineCard(contents ? { ...legacy, contents } : message);
}
