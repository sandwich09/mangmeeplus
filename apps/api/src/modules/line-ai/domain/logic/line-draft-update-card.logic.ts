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
 * The two buttons carry `action=draft-update-confirm` / `action=draft-update-cancel` and NOTHING
 * else — no preview id, no expense id, no company id (P10-L SEC-04). The server re-derives the
 * pending preview from the chat that pressed the button, so a forged postback can reach no further
 * than typing the same words could.
 */
import { scrubRecordIdentifier, scrubRecordText, type LineDraftUpdateDiffField, type LineDraftUpdatePreview } from '@watchdog-bms/contracts';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { absoluteWebLink } from '../../../../common/http/web-link';

export const DRAFT_UPDATE_CONFIRM_COMMAND = 'ยืนยันการแก้ไข';
export const DRAFT_UPDATE_CANCEL_COMMAND = 'ยกเลิกการแก้ไข';

/** At most this many diff rows are printed; the rest are summarised. A card is a decision aid. */
const MAX_DIFF_ROWS = 5;

function money(value: string): string {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
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
      return scrubRecordText(value, 60) || '—';
    case 'identifier':
      // Null means "not a document number at all" — a value that could read as a total or a host.
      return scrubRecordIdentifier(value, 40) ?? '—';
    case 'date':
      return formatThaiDate(value);
    case 'money':
      return money(value);
    case 'plain':
      // Server-generated, but still bounded: a constant that grew unexpectedly must not blow up a bubble.
      return value.slice(0, 60);
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

/** "จะเพิ่มค่าบริการ 10% = 152.00 ให้บิล BHC 03/09/2569 ยอดรวมใหม่ 1,789.04 ค่ะ" — the one line the
 *  card leads with, built from the diff rather than written per tool. */
export function draftUpdateHeadline(preview: LineDraftUpdatePreview): string {
  const changes = preview.diff.slice(0, MAX_DIFF_ROWS)
    .map((entry) => `${entry.label}: ${cell(entry.before, entry.kind)} → ${cell(entry.after, entry.kind)}`)
    .join(' · ');
  // The label is built from structured fields, but the vendor name inside it is still OCR text —
  // so it is bounded here too rather than trusted because an earlier layer already scrubbed it.
  return `จะแก้ ${formatRecordLabel(preview.record)} — ${changes}`;
}

export function buildDraftUpdatePreviewCard(preview: LineDraftUpdatePreview): LineReplyMessage {
  const totalChanged = preview.totalsBefore.grandTotalAmount !== preview.totalsAfter.grandTotalAmount;
  const rows = preview.diff.slice(0, MAX_DIFF_ROWS).map((entry) => ({
    type: 'box' as const,
    layout: 'vertical' as const,
    contents: [
      { type: 'text' as const, text: entry.label, size: 'xs' as const, color: '#667085', wrap: true },
      { type: 'text' as const, text: `${cell(entry.before, entry.kind)} → ${cell(entry.after, entry.kind)}`, size: 'sm' as const, color: '#101828', wrap: true },
    ],
  }));
  const hidden = Math.max(preview.diff.length - MAX_DIFF_ROWS, 0);
  return {
    type: 'flex',
    // The plain-text equivalent LINE shows when Flex cannot render: same numbers, no buttons, so a
    // fallback delivery never silently loses the amount the user is being asked about.
    altText: `${draftUpdateHeadline(preview)} · ยอดรวมใหม่ ${money(preview.totalsAfter.grandTotalAmount)} — ตอบ "${DRAFT_UPDATE_CONFIRM_COMMAND}" หรือ "${DRAFT_UPDATE_CANCEL_COMMAND}"`,
    contents: {
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
          ...preview.warnings.slice(0, 2).map((warning) => ({
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
          // SEC-04: intent only. No ids ride in `data`, so the server must re-derive the preview
          // from the chat — which is exactly what makes a replayed or forged postback inert.
          {
            type: 'button',
            style: 'primary',
            color: '#22C55E',
            action: { type: 'postback', label: 'ยืนยัน', data: 'action=draft-update-confirm', displayText: DRAFT_UPDATE_CONFIRM_COMMAND },
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'postback', label: 'ยกเลิก', data: 'action=draft-update-cancel', displayText: DRAFT_UPDATE_CANCEL_COMMAND },
          },
        ],
      },
    },
  };
}

/** J3.2 — what actually changed, then the link. Numbers copied from the applied preview. */
export function draftUpdateAppliedReply(
  webBaseUrl: string | undefined,
  companyId: string,
  expenseId: string,
  preview: LineDraftUpdatePreview,
): string {
  const changes = preview.diff.slice(0, MAX_DIFF_ROWS)
    .map((entry) => `${entry.label} ${cell(entry.after, entry.kind)}`)
    .join(' · ');
  return [
    `✅ แก้ให้แล้วค่ะ: ${changes} · ยอดรวม ${money(preview.totalsAfter.grandTotalAmount)}`,
    `ดูในเว็บ: ${absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`)}`,
  ].join('\n');
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
): string {
  const listLink = absoluteWebLink(webBaseUrl, `/companies/${companyId}/expenses`);
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
