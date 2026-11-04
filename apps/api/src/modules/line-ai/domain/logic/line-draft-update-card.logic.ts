import { lineReplyLanguage, lineDisplayDate, lineControlData, lineUiLabel, type LineReplyLanguage } from './line-language.logic';
import { lineMessagePreview } from './line-message-preview.logic';
/**
 * The LINE surface of S-4 (draft-control spec §5.4, J3): one confirm card and the replies that
 * follow it.
 *
 * Everything here is deterministic. Every money figure is copied from the `LineDraftUpdatePreview`
 * the server computed by running the real write path and rolling it back — no model phrases a
 * number in this file, and no free text from a receipt reaches a bubble unscrubbed (the diff was
 * scrubbed where it was built; the card re-bounds anyway, because a card is the last place that
 * could print a total nobody calculated).
 *
 * The two buttons carry the exact preview id shown on this card, and no expense or company id.
 * The server re-checks company, chat, user, permission, status and record revision before acting.
 */
import {
  LINE_DRAFT_UPDATE_CARD_CONTEXT, LINE_DRAFT_UPDATE_CARD_STATES, LINE_DRAFT_UPDATE_CONFIRM_HINT, lineDraftUpdateBlockedState, scrubRecordIdentifier, scrubRecordText,
  type LineDraftUpdateCardState, type LineDraftUpdateDiffField, type LineDraftUpdatePreview, type VendorCounterpartyAutoSaveResult,
} from '@watchdog-bms/contracts';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { absoluteWebLink } from '../../../../common/http/web-link';
import type { LineSystemCard, LineSystemCardRow } from './line-system-card.logic';
import { drawLineSystemCard } from './line-system-card-limits.logic';
import { buildLineSystemTextCardMessage } from './line-business-card.logic';
import type { ExpenseActionPreview } from '../../application/line-expense-action.service';

export const DRAFT_UPDATE_CONFIRM_COMMAND = 'ยืนยันการแก้ไข';
export const DRAFT_UPDATE_CANCEL_COMMAND = 'ยกเลิกการแก้ไข';

/** At most this many diff rows are printed; the rest are summarised. A card is a decision aid. */
const MAX_DIFF_ROWS = 64;

function money(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return '—';
  const fraction = (match[3] ?? '').replace(/0+$/, '').padEnd(2, '0');
  return `${match[1]}${match[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

/**
 * Render one diff value according to WHERE IT CAME FROM, which the row states.
 *
 * Scrubbing everything was the bug: a card that says "วันที่เอกสาร: …-…-…" and "อัตรา VAT: …" has
 * destroyed the only thing it exists to communicate. `text` is the attacker's and is scrubbed;
 * `identifier` keeps its digits (they ARE the value); `money`, `date` and `plain` are figures and
 * labels this server produced and are printed as they are, bounded.
 */
function cell(value: string | null, kind: LineDraftUpdateDiffField['kind'] = 'text'): string {
  if (value === null) return 'ยังไม่ระบุ';
  switch (kind) {
    case 'text':
      return scrubRecordText(value, 1000) || '—';
    case 'identifier':
      // Null means "not a document number at all" — a value that could read as a total or a host.
      return scrubRecordIdentifier(value, 1000) ?? '—';
    case 'date':
      return formatThaiDate(value);
    case 'money':
      return money(value);
    case 'plain':
      // Server-generated, but still bounded: a constant that grew unexpectedly must not blow up a bubble.
      return value;
  }
}

/** The same Buddhist-era shape every other LINE reply uses, e.g. 3 ก.ย. 2569. */
const THAI_DATE = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' });

export function formatThaiDate(isoDate: string): string {
  const parsed = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? isoDate.slice(0, 20) : THAI_DATE.format(parsed);
}

/**
 * The record this edit targets, composed from typed fields. The vendor name already arrived
 * scrubbed from the use case; it is scrubbed again here because this builder is exported and the
 * next caller may not be. The date and status are the server's and are formatted, never masked.
 */
export function formatRecordLabel(record: LineDraftUpdatePreview['record']): string {
  const vendor = scrubRecordText(record.vendorName, 40);
  return [vendor || 'ไม่ระบุผู้ขาย', formatThaiDate(record.expenseDate), record.statusLabel.slice(0, 40)].join(' · ');
}

function diffValue(entry: LineDraftUpdatePreview['diff'][number]): string {
  return `${cell(entry.before, entry.kind)} → ${cell(entry.after, entry.kind)}`;
}

/** "จะเพิ่มค่าบริการ 10% = 152.00 ให้บิล BHC 03/09/2569 ยอดรวมใหม่ 1,789.04 ค่ะ" — the one line the
 *  card leads with, built from the diff rather than written per tool. */
export function draftUpdateHeadline(preview: LineDraftUpdatePreview): string {
  const changes = preview.diff.slice(0, MAX_DIFF_ROWS)
    .map((entry) => `${entry.label}: ${diffValue(entry)}`)
    .join(' · ');
  // The label is built from structured fields, but the vendor name inside it is still OCR text —
  // so it is bounded here too rather than trusted because an earlier layer already scrubbed it.
  return `จะแก้ ${formatRecordLabel(preview.record)} — ${changes}`;
}

export function draftUpdateCanonicalDiff(preview: LineDraftUpdatePreview, language: LineReplyLanguage = 'th'): string {
  if (language === 'en') { const card = buildDraftUpdatePreviewCard(preview, undefined, language); return card.type === 'flex' ? card.canonicalText! : ''; }
  return [`ยืนยันการแก้ไขรายการ ${formatRecordLabel(preview.record)}`,
    ...preview.diff.map(entry => `${entry.label}: ${diffValue(entry)}`),
    `ยอดรวมเดิม ${money(preview.totalsBefore.grandTotalAmount)} → ยอดรวมใหม่ ${money(preview.totalsAfter.grandTotalAmount)}`,
    ...preview.warnings.map(warning => `⚠️ ${scrubRecordText(warning, 1000)}`)].join('\n');
}

/** The locked design's "แก้ไขค่าใช้จ่าย" header: the context, then the state the edit is really in.
 *  The words live in the contracts, where the gateway's layout of the same card reads them too. */
export type DraftUpdateCardState = LineDraftUpdateCardState;
export const draftUpdateCardHeader = (state: DraftUpdateCardState): LineSystemCard['header'] =>
  ({ lines: [LINE_DRAFT_UPDATE_CARD_CONTEXT, LINE_DRAFT_UPDATE_CARD_STATES[state]] });
export const draftUpdateBlockedState = lineDraftUpdateBlockedState;

/** The proposal on the locked design: the record, every change, the new total in the cream row, and
 *  the two buttons side by side. Same facts, same order of meaning and same postbacks as before.
 *  `undefined` where the design cannot be drawn so that LINE accepts it; the card it had before is sent. */
function previewBubble(preview: LineDraftUpdatePreview, webBaseUrl: string | undefined, language: LineReplyLanguage = 'th'): Record<string, unknown> | undefined {
  const totalChanged = preview.totalsBefore.grandTotalAmount !== preview.totalsAfter.grandTotalAmount;
  const rows: LineSystemCardRow[] = [
    { label: 'ผู้ขาย', value: scrubRecordText(preview.record.vendorName, 40) || 'ไม่ระบุผู้ขาย' },
    { label: 'วันที่เอกสาร', value: formatThaiDate(preview.record.expenseDate) },
    { label: 'สถานะเอกสาร', value: preview.record.statusLabel.slice(0, 40) },
    ...preview.diff.map((entry) => ({ label: entry.label, value: diffValue(entry) })),
    // An edit that leaves the total where it was has no "new" total to announce.
    ...(totalChanged
      ? [{ label: 'ยอดรวมใหม่', value: money(preview.totalsAfter.grandTotalAmount), total: true }, { label: 'ยอดรวมเดิม', value: money(preview.totalsBefore.grandTotalAmount) }]
      : [{ label: 'ยอดรวม', value: `${money(preview.totalsAfter.grandTotalAmount)} (ไม่เปลี่ยน)`, total: true }]),
  ];
  const en = language === 'en';
  if (en) {
    rows.splice(0, rows.length,
      ...(preview.record.vendorName?.trim() ? [{ label: 'Seller', value: scrubRecordText(preview.record.vendorName, 40) }] : []),
      { label: 'Document date', value: lineDisplayDate(preview.record.expenseDate, language) },
      { label: 'Status', value: lineUiLabel(preview.record.statusLabel, language) },
      ...preview.diff.map(entry => ({ label: englishDiffLabel(entry), value: `${entry.before === null ? 'Not provided' : entry.kind === 'date' ? lineDisplayDate(entry.before, language) : entry.kind === 'money' ? money(entry.before) : lineUiLabel(cell(entry.before, entry.kind), language)} → ${entry.after === null ? 'Not provided' : entry.kind === 'date' ? lineDisplayDate(entry.after, language) : entry.kind === 'money' ? money(entry.after) : lineUiLabel(cell(entry.after, entry.kind), language)}` })),
      { label: totalChanged ? 'New total' : 'Total', value: money(preview.totalsAfter.grandTotalAmount), total: true },
      ...(totalChanged ? [{ label: 'Previous total', value: money(preview.totalsBefore.grandTotalAmount) }] : []));
  }
  return drawLineSystemCard({
    // A record with no state or date on it has no such row; an empty cell is never drawn.
    mascot: 'general', header: en ? { lines: ['Expense changes', 'Review changes'] } : draftUpdateCardHeader('preview'), rows: rows.filter((row) => row.value.trim()),
    notes: preview.warnings.map((warning) => `⚠️ ${lineUiLabel(scrubRecordText(warning, 160), language)}`),
    footnotes: [en ? 'Nothing has been changed; review before confirming.' : LINE_DRAFT_UPDATE_CONFIRM_HINT],
    // SEC-04: the opaque id binds this button to this card; the server still rechecks the
    // current preview, user/chat binding, record revision, permissions and status.
    choice: [
      { type: 'postback', label: en ? 'Confirm changes' : 'ยืนยัน', data: lineControlData('action=draft-update-confirm&previewId=' + encodeURIComponent(preview.previewId), language), displayText: en ? 'Confirm expense changes' : DRAFT_UPDATE_CONFIRM_COMMAND },
      { type: 'postback', label: en ? 'Cancel changes' : 'ยกเลิก', data: lineControlData('action=draft-update-cancel&previewId=' + encodeURIComponent(preview.previewId), language), displayText: en ? 'Cancel expense changes' : DRAFT_UPDATE_CANCEL_COMMAND },
    ],
  }, webBaseUrl);
}

/** A row of the locked design holds this much; a longer label or change is shown on the card it had before. */
const DESIGN_DIFF_ROWS = 10;
const DESIGN_ROW_CHARS = 200;

function englishDiffLabel(entry: LineDraftUpdateDiffField): string {
  const fields: Record<string, string> = { expenseDate: 'Document date', vendorName: 'Seller / payee', documentNumber: 'Document number', note: 'Add note', vatMode: 'VAT mode', vatRate: 'VAT rate' };
  const line = /^line\.(\d+)\.(.+)$/u.exec(entry.field);
  if (line) return `Item ${line[1]} ${({ category: 'category', description: 'description', amount: 'amount', quantity: 'quantity', discount: 'discount to clear', vatTreatment: 'VAT option', chargeKind: 'additional charge' } as Record<string, string>)[line[2]!] ?? 'change'}`;
  if (entry.field.startsWith('charge.')) return lineUiLabel(entry.label, 'en');
  return fields[entry.field] ?? lineUiLabel(entry.label, 'en');
}

export function buildDraftUpdatePreviewCard(preview: LineDraftUpdatePreview, webBaseUrl?: string, language: LineReplyLanguage = 'th'): LineReplyMessage {
  const en = language === 'en';
  if (language === 'en') {
    const value = (value: string | null, kind: LineDraftUpdateDiffField['kind']) => value === null ? 'Not provided' : kind === 'date'
      ? lineDisplayDate(value, language) : kind === 'money' ? money(value) : kind === 'plain' ? lineUiLabel(cell(value, kind), language) : cell(value, kind);
    const changes = preview.diff.map(entry => `${englishDiffLabel(entry)}: ${value(entry.before, entry.kind)} → ${value(entry.after, entry.kind)}`);
    const lines = [`Review expense changes for ${scrubRecordText(preview.record.vendorName, 40) || 'this seller'}.`,
      `Date: ${lineDisplayDate(preview.record.expenseDate, language)}`, `Status: ${lineUiLabel(preview.record.statusLabel, language)}`, ...changes,
      `Previous total: ${money(preview.totalsBefore.grandTotalAmount)} → New total: ${money(preview.totalsAfter.grandTotalAmount)}`,
      ...preview.warnings.map(warning => lineUiLabel(scrubRecordText(warning, 1000), language)), 'Nothing has been changed; review the details before confirming.'];
    const designed = previewBubble(preview, webBaseUrl, language);
    if (designed) return { type: 'flex', altText: lineMessagePreview(lines.join(' '), 400), canonicalText: lines.join('\n'), contents: designed };
    return { type: 'flex', altText: lineMessagePreview(lines.join(' '), 400), canonicalText: lines.join('\n'), contents: { type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: lines.map(text => ({ type: 'text', text, wrap: true })) },
      footer: { type: 'box', layout: 'horizontal', contents: [['draft-update-confirm', 'Confirm changes'], ['draft-update-cancel', 'Cancel changes']].map(([action, label]) => ({
        type: 'button', action: { type: 'postback', label, data: lineControlData(new URLSearchParams({ action: action!, previewId: preview.previewId }).toString(), language) } })) } } };
  }
  const totalChanged = preview.totalsBefore.grandTotalAmount !== preview.totalsAfter.grandTotalAmount;
  const designed = preview.diff.length <= DESIGN_DIFF_ROWS && preview.warnings.length <= 3
    && preview.diff.every((entry) => entry.label.trim() && Array.from(entry.label).length <= 40 && Array.from(diffValue(entry)).length <= DESIGN_ROW_CHARS)
    ? previewBubble(preview, webBaseUrl) : undefined;
  const rows = preview.diff.slice(0, MAX_DIFF_ROWS).map((entry) => ({
    type: 'box' as const,
    layout: 'vertical' as const,
    contents: [
      { type: 'text' as const, text: entry.label, size: 'xs' as const, color: '#667085', wrap: true },
      { type: 'text' as const, text: diffValue(entry), size: 'sm' as const, color: '#101828', wrap: true },
    ],
  }));
  const hidden = Math.max(preview.diff.length - MAX_DIFF_ROWS, 0);
  return {
    type: 'flex',
    // The plain-text equivalent LINE shows when Flex cannot render: same numbers, no buttons, so a
    // fallback delivery never silently loses the amount the user is being asked about.
    altText: lineMessagePreview(`${draftUpdateHeadline(preview)} · ยอดรวมใหม่ ${money(preview.totalsAfter.grandTotalAmount)} — หากไม่เห็นปุ่ม ให้ส่งคำขอแก้ไขใหม่เพื่อรับบัตรอีกครั้ง`),
    canonicalText: draftUpdateCanonicalDiff(preview),
    contents: designed ?? {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: 'ยืนยันการแก้ไขรายการ', weight: 'bold', size: 'lg', color: '#101828', wrap: true },
          { type: 'text', text: formatRecordLabel(preview.record), size: 'sm', color: '#475467', wrap: true },
          { type: 'separator', margin: 'md' },
          ...rows,
          ...(hidden > 0 ? [{ type: 'text' as const, text: `และอีก ${hidden} รายการ`, size: 'xs' as const, color: '#667085' }] : []),
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'baseline',
            contents: [
              { type: 'text', text: 'ยอดรวมใหม่', size: 'sm', color: '#475467', flex: 3 },
              {
                type: 'text',
                text: money(preview.totalsAfter.grandTotalAmount),
                size: 'md',
                weight: 'bold',
                color: totalChanged ? '#B54708' : '#101828',
                align: 'end',
                flex: 4,
              },
            ],
          },
          ...(totalChanged
            ? [{
                type: 'text' as const,
                text: `เดิม ${money(preview.totalsBefore.grandTotalAmount)}`,
                size: 'xs' as const,
                color: '#667085' as const,
                align: 'end' as const,
              }]
            : []),
          ...preview.warnings.map((warning) => ({
            type: 'text' as const,
            text: `⚠️ ${scrubRecordText(warning, 160)}`,
            size: 'xs' as const,
            color: '#B54708' as const,
            wrap: true,
          })),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          // SEC-04: the opaque id binds this button to this card; the server still rechecks the
          // current preview, user/chat binding, record revision, permissions and status.
          {
            type: 'button',
            style: 'primary',
            color: '#22C55E',
            action: { type: 'postback', label: en ? 'Confirm changes' : 'ยืนยัน', data: lineControlData('action=draft-update-confirm&previewId=' + encodeURIComponent(preview.previewId), language), displayText: en ? 'Confirm expense changes' : DRAFT_UPDATE_CONFIRM_COMMAND },
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'postback', label: en ? 'Cancel changes' : 'ยกเลิก', data: lineControlData('action=draft-update-cancel&previewId=' + encodeURIComponent(preview.previewId), language), displayText: en ? 'Cancel expense changes' : DRAFT_UPDATE_CANCEL_COMMAND },
          },
        ],
      },
    },
  };
}

/** What became of an edit, on the locked design: the header says the state, the body is the reply
 *  itself and its web link is the button. `undefined` where the design cannot be drawn. */
export function buildDraftUpdateOutcomeCard(
  state: DraftUpdateCardState,
  reply: string,
  webBaseUrl: string | undefined,
  companyId: string,
  confirmation?: ExpenseActionPreview,
): LineReplyMessage | undefined {
  const language = lineReplyLanguage(reply);
  const text = [reply, ...(confirmation ? [confirmation.summary, ...(confirmation.details ?? [])] : [])].filter(Boolean).join('\n');
  return buildLineSystemTextCardMessage({ text, header: draftUpdateCardHeader(state), webBaseUrl, companyId, linkLabel: confirmation ? language === 'en' ? 'Open expense' : 'เปิดรายการ' : 'ดูในเว็บ',
    ...(confirmation ? { action: { type: 'postback' as const, label: language === 'en' ? 'Confirm expense' : 'ยืนยันรายการ',
      data: lineControlData(new URLSearchParams({ action: 'expense_action_confirm', token: confirmation.token }).toString(), language) } } : {}) });
}

/** J3.2 — what actually changed, then the link. Numbers copied from the applied preview. */
export function draftUpdateAppliedReply(
  webBaseUrl: string | undefined,
  companyId: string,
  expenseId: string,
  preview: LineDraftUpdatePreview,
  vendorAutoSave?: VendorCounterpartyAutoSaveResult,
  language: LineReplyLanguage = 'th',
): string {
  if (language === 'en') return [`Changes saved: ${preview.diff.map(entry => `${englishDiffLabel(entry)} ${entry.after === null ? 'Not provided' : entry.kind === 'date' ? lineDisplayDate(entry.after, language) : entry.kind === 'plain' ? lineUiLabel(cell(entry.after, entry.kind), language) : cell(entry.after, entry.kind)}`).join(' · ')} · Total ${money(preview.totalsAfter.grandTotalAmount)}`,
    `View expense: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`)}`,
    ...(vendorAutoSave?.linkFailed ? ['The supplier was saved, but could not be linked; please review the expense on the web.']
      : vendorAutoSave?.failed || vendorAutoSave?.case === 'FAILED' ? ['The expense was saved; supplier registration failed and can be retried on the supplier page.']
        : vendorAutoSave?.case === 'CREATE' ? [`Supplier registered: ${scrubRecordText(vendorAutoSave.displayName, 60) || 'this seller'}.`] : [])].join('\n');
  const changes = preview.diff.slice(0, MAX_DIFF_ROWS)
    .map((entry) => `${entry.label} ${cell(entry.after, entry.kind)}`)
    .join(' · ');
  const reply = [
    `✅ แก้ให้แล้วค่ะ: ${changes} · ยอดรวม ${money(preview.totalsAfter.grandTotalAmount)}`,
    `ดูในเว็บ: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`)}`,
  ];
  if (vendorAutoSave?.linkFailed) {
    reply.push('บันทึกร้านในทะเบียนคู่ค้าแล้ว แต่เชื่อมกับรายการนี้ไม่สำเร็จ กรุณาเปิดรายการในเว็บเพื่อตรวจสอบ');
  } else if (vendorAutoSave?.failed || vendorAutoSave?.case === 'FAILED') {
    reply.push('บันทึกรายจ่ายสำเร็จแล้ว แต่ยังไม่ได้บันทึกลงทะเบียนคู่ค้า ลองใหม่ได้จากหน้าคู่ค้า');
  } else if (vendorAutoSave?.case === 'CREATE') {
    reply.push('บันทึก' + (scrubRecordText(vendorAutoSave.displayName, 60) || 'ร้านนี้') + ' ลงทะเบียนคู่ค้าแล้ว');
  }
  return reply.join('\n');
}

/** What the correction lane's `proposeDraftUpdate` did with a turn. */
export type DraftProposalOutcome = 'proposed' | 'answered' | 'not_handled';

/**
 * Which clarification-ack reason a draft-lane turn records (spec §8 ledger hygiene).
 *
 * NEITHER handled outcome writes: a preview is a question the user has still to answer, and a
 * refusal is a sentence. `correction_apply` would make the ledger read as though money moved on
 * this turn — the one thing this lane exists never to do without a confirm postback. It is a
 * function so that claim is testable; inline, it was a ternary whose comment said the opposite of
 * what it did.
 */
export function draftProposalAckReason(outcome: DraftProposalOutcome): 'correction_guidance' {
  return 'correction_guidance';
}

export const DRAFT_UPDATE_CANCELLED_REPLY = 'ยกเลิกแล้วค่ะ ยังไม่ได้แก้อะไรในรายการนะคะ';
/** A second tap on a card whose confirm already went through. Not "expired" — that would deny an
 *  edit the user really did make. */
export const DRAFT_UPDATE_ALREADY_APPLIED_PREFIX = 'แก้ไปแล้วค่ะ';
export const DRAFT_UPDATE_EXPIRED_REPLY = 'ไม่พบรายการที่รอยืนยันในแชทนี้ค่ะ (อาจหมดเวลาไปแล้ว) พิมพ์สิ่งที่ต้องการแก้อีกครั้งได้เลยค่ะ';

/** §5.4: the record moved between the card and the button, so the proposal described something
 *  that no longer exists. It is dropped, never re-based onto the new version. */
export function draftUpdateChangedReply(webBaseUrl: string | undefined, companyId: string, expenseId: string): string {
  return [
    'รายการเปลี่ยนไปแล้ว ขอดูใหม่นะคะ',
    `ตรวจสอบในเว็บ: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`)}`,
  ].join('\n');
}

/** J3.4 — CONFIRMED/VOIDED. Not "out of scope": the record is real and the answer says where to go. */
export function draftUpdateMutationBlockedReply(webBaseUrl: string | undefined, companyId: string, expenseId?: string): string {
  const link = expenseId
    ? absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`)
    : absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses`);
  return `รายการนี้ยืนยันไปแล้ว แก้ผ่าน LINE ไม่ได้ค่ะ ไปที่เว็บ ${link} เพื่อยกเลิกหรือแก้`;
}

/** J3.3 — the receipt already carries this charge as a product line, so the honest move is to
 *  offer the MOVE, never a second charge row. The reply names the line the user must confirm. */
export function draftUpdateMoveSuggestionReply(lineNumber: number, chargeLabel: string): string {
  return `บิลนี้มี "${scrubRecordText(chargeLabel, 40)}" เป็นรายการสินค้าอยู่แล้ว (บรรทัด ${lineNumber}) ค่ะ`
    + ` จะไม่เพิ่มซ้ำนะคะ — พิมพ์ "ย้ายบรรทัด ${lineNumber} เป็นช่องค่าบริการ" ถ้าต้องการย้ายเป็นช่องค่าใช้จ่ายเพิ่มค่ะ`;
}

/** Everything the preview could refuse, as one honest line each. No code name reaches the user. */
export function draftUpdateBlockedReply(
  reason: string,
  webBaseUrl: string | undefined,
  companyId: string,
  expenseId?: string,
  language: LineReplyLanguage = 'th',
): string {
  const listLink = absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses`);
  if (language === 'en') {
    const replies: Record<string, string> = {
      mutation_blocked: 'This change must be made in the web app.', forbidden: 'Ask the shop owner or an authorized editor to change this expense.',
      no_recent_record: 'No recent editable expense was found in this chat.', ambiguous_record: 'Which expense would you like to change?',
      ambiguous_line: 'Which item in this expense would you like to change?', ungrounded_value: 'Nothing has been changed; please provide the exact value.',
      rate_limited: 'Please wait a moment before requesting another change.',
    };
    return `${replies[reason] ?? 'This change is unavailable in LINE; please use the web app.'}\nView expenses: ${listLink}`;
  }
  switch (reason) {
    case 'mutation_blocked':
      return draftUpdateMutationBlockedReply(webBaseUrl, companyId, expenseId);
    case 'forbidden':
      return `คุณยังไม่มีสิทธิ์แก้รายการค่าใช้จ่ายค่ะ ส่งต่อให้ผู้มีสิทธิ์แก้ในเว็บได้ที่ ${listLink}`;
    case 'no_recent_record':
      return `ยังไม่พบรายการที่บันทึกไว้ล่าสุดในแชทนี้ที่แก้ไขได้ค่ะ เปิดดูในเว็บได้ที่ ${listLink}`;
    case 'ambiguous_record':
      return `มีหลายรายการล่าสุดในแชทนี้ ขอให้ระบุรายการก่อนนะคะ หรือแก้ในเว็บที่ ${listLink}`;
    case 'ambiguous_line':
      // The same question the five-field lane has always asked when an amount could land on more
      // than one row — kept word-for-word so the journey does not change shape under the flag.
      return 'บิลนี้มีหลายบรรทัดค่ะ ขอทราบว่าต้องการแก้บรรทัดไหนนะคะ (เช่น "บรรทัด 2 เป็น 500")';
    case 'ungrounded_value':
      return 'ยังไม่ได้แก้ยอดให้นะคะ เพราะยังไม่แน่ใจตัวเลขที่ต้องการ พิมพ์ตัวเลขให้ชัดอีกครั้งได้เลยค่ะ (เช่น "ค่าบริการ 10%")';
    case 'rate_limited':
      return 'ขอพักสักครู่นะคะ มีคำขอแก้ไขเข้ามาถี่เกินไป ลองใหม่อีกครั้งในอีกสักครู่ค่ะ';
    default:
      return `ยังแก้รายการนี้ผ่าน LINE ไม่ได้ค่ะ แก้ในเว็บได้ที่ ${listLink}`;
  }
}
