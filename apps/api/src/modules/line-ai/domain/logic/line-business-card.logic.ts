import { lineWorkflowOpenData, CLAIM_WORKFLOW_ACTIONS, type ClaimWorkflowId } from './line-reimbursement-approval-control.logic';
import { formatClaimMoney } from './line-reimbursement-draft-card.logic';
import type { LineWorkflowTargets } from '../../application/line-workflow-target.service';
import { lineReplyLanguage, lineCustomerText, lineUiLabel, lineSourceLabel, lineControlData, type LineReplyLanguage } from './line-language.logic';
import { scrubRecordIdentifier, AI_BUDGET_REFUSAL_CODES, mayOfferWorkflow, canUseLineChatAction, lineChatAction, parseLineAiAnswerCardLayout, type AiBudgetScope, type LineAiAnswerCard, type LineAiAnswerCardLayout, type LineAiTurnResponse, type PlanTermLockReason } from '@watchdog-bms/contracts';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import type { ExpenseActionPreview } from '../../application/line-expense-action.service';
import { lineMessagePreview as preview } from './line-message-preview.logic';
import { lineSystemCardAvailable, type LineSystemCard, type LineSystemCardIcon, type LineSystemCardAction, type LineSystemCardRow } from './line-system-card.logic';
import { drawLineSystemCard, LINE_SYSTEM_CARD_BUTTONS_MAX, lineSystemCardPillHolds } from './line-system-card-limits.logic';
import type { ReceiptProgress } from './line-receipt-status.logic';
import {
  EMPLOYEE_DOOR_COMMAND,
  PACKAGE_CHANGE_COMMAND,
  STAFF_CONTACT_COMMAND,
  STAFF_OA_URL,
  PROFILE_GUARD_COMMAND,
  PROFILE_GUARD_LATER_COMMAND,
  VIEW_PACKAGES_COMMAND,
} from './line-staff-menu.logic';

import { publicPolicyAnswerLanguage, type PublicPolicyAnswer } from './line-public-policy.logic';
import { HANDOFF_PATH_PREFIX } from '../../../auth/domain/logic/line-handoff.logic';
import { ASK_PLAN_MANAGER_TH } from '../../../access-control/domain/logic/plan-manager.logic';

const THEME = {
  brand: '#22C55E',
  brandDark: '#15803D',
  text: '#1A2E22',
  muted: '#475467',
  border: '#E3EBE5',
  surface: '#FFFFFF',
} as const;

const bounded = (value: string, max: number) => Array.from(value.trim()).slice(0, max).join('');
const ANSWER_CARD_LIMIT = 12;
const ANSWER_CARD_TITLE_LIMIT = 80;
const ANSWER_CARD_BODY_LIMIT = 1_200;
const ANSWER_CARD_BADGE_LIMIT = 40;
const ANSWER_CARD_SOURCE_LIMIT = 5;
const ANSWER_CARD_SOURCE_LABEL_LIMIT = 60;
const completeBusinessAnswerPresentations = new WeakMap<object, string>();

export function lineChoiceQuickReply(choices: readonly { label: string; text: string; uri?: string; cameraRoll?: boolean; data?: string }[]): NonNullable<LineReplyMessage['quickReply']> {
  return { items: choices.slice(0, 13).map(choice => ({ type: 'action', action: choice.uri
    ? { type: 'uri', label: Array.from(choice.label).slice(0, 20).join(''), uri: choice.uri }
    : choice.cameraRoll ? { type: 'cameraRoll', label: Array.from(choice.label).slice(0, 20).join('') }
    : choice.data ? { type: 'postback', label: Array.from(choice.label).slice(0, 20).join(''), data: choice.data, displayText: choice.text }
    : { type: 'message', label: Array.from(choice.label).slice(0, 20).join(''), text: choice.text } })) };
}

/** Recheck current access; a gateway-selected action is navigation advice, never authority. */
export function productHelpQuickReply(response: LineAiTurnResponse, permissions: readonly string[], entitled: ReadonlySet<string> | null, language: LineReplyLanguage = lineReplyLanguage(response.replyText ?? '')): LineReplyMessage['quickReply'] | undefined {
  if (response.refused) return undefined;
  const capabilityMenu = response.presentation?.cards.some(card => card.chatActionIds !== undefined);
  const ids = response.presentation?.cards.flatMap(card => card.chatActionIds ?? (card.chatActionId ? [card.chatActionId] : [])) ?? [];
  const actions = [...new Set(ids)].map(id => lineChatAction(id)).filter(action => action && !('webPath' in action)
    && ('workflow' in action && action.workflow ? mayOfferWorkflow(action.id, permissions, entitled)
      : canUseLineChatAction(action.id, permissions, entitled))).slice(0, 6);
  if (!actions.length) return undefined;
  if (!capabilityMenu && actions.length === 1 && language === 'th' && !('workflow' in actions[0]!)) return lineChoiceQuickReply([{ label: 'ให้น้องทำให้', text: actions[0]!.command }]);
  const shortTitles: Record<string, string> = { counterparty: 'เพิ่มคู่ค้า', package_purchase: 'เลือกแพ็กเกจ', expense_search: 'ค้นหาค่าใช้จ่าย', sales: 'ดูยอดขาย', inventory: 'ค้นหาสินค้า' };
  return { items: actions.map(action => ({ type: 'action', action: { type: 'postback',
    label: !capabilityMenu && actions.length === 1 ? language === 'en' ? 'Prepare this for me' : 'ให้น้องทำให้' : lineUiLabel(shortTitles[action!.id] ?? action!.title, language),
    data: lineControlData(new URLSearchParams({ action: 'chat-action', id: action!.id }).toString(), language) } })) };

}

function businessAnswerPresentationFingerprint(message: LineReplyMessage): string | null {
  return message.type === 'flex'
    ? JSON.stringify([message.altText, message.canonicalText, message.contents])
    : null;
}

/** Ephemeral renderer proof. It never enters the frozen message, JSON, hashes, persistence, or LINE payloads. */
export function isCompleteLineBusinessAnswerPresentation(message: LineReplyMessage): boolean {
  const fingerprint = businessAnswerPresentationFingerprint(message);
  return fingerprint !== null && completeBusinessAnswerPresentations.get(message) === fingerprint;
}

/** Preserve the renderer proof only across the API's completion-menu clone. An unproved source cannot mint it. */
export function inheritCompleteLineBusinessAnswerPresentation<T extends LineReplyMessage>(source: LineReplyMessage, target: T): T {
  const fingerprint = businessAnswerPresentationFingerprint(target);
  if (isCompleteLineBusinessAnswerPresentation(source)
    && fingerprint !== null
    && fingerprint === businessAnswerPresentationFingerprint(source)) completeBusinessAnswerPresentations.set(target, fingerprint);
  return target;
}

/** A server-worded card whose bubble holds its whole sentence is a complete presentation too, so a
 *  delivery plan sends the card itself — a limit card exists for its buttons — and keeps the sentence
 *  as the text fallback. A sentence the bubble body would cut stays text-first. */
function completeCard(message: LineReplyMessage, bodyText: string): LineReplyMessage {
  if (Array.from(bodyText.trim()).length <= ANSWER_CARD_BODY_LIMIT) {
    completeBusinessAnswerPresentations.set(message, businessAnswerPresentationFingerprint(message)!);
  }
  return message;
}

/** A server-built menu card that shows every line of its canonical text (its title, its lines and each
 *  button) is a complete presentation as well. Without this proof a delivery plan sends such a card
 *  as its text: on UAT 2026-10-05 "รายการรออนุมัติ" arrived as plain text with a raw link. */
export function asCompleteLineCard<T extends LineReplyMessage>(message: T): T {
  const fingerprint = businessAnswerPresentationFingerprint(message);
  if (fingerprint !== null && message.type === 'flex' && message.canonicalText !== undefined) {
    completeBusinessAnswerPresentations.set(message, fingerprint);
  }
  return message;
}

/**
 * A URI button, one that sends a text command the webhook already answers (`โปรโมชั่น`), or one
 * that posts a bare intent back (P10-L G-04). Postback `data` never carries an id or any state —
 * see `linePostbackCommandText`, which is the only thing that reads it.
 */
type SafeButton =
  | { label: string; uri: string }
  | { label: string; text: string }
  | { label: string; data: string };

/** A labelled fact on its own line of the card body. §10.1 asks the expense/reimbursement summaries to
 *  be STRUCTURED rows rather than one wrapped paragraph, so the reader sees each fact separately. */
type DetailRow = { label: string; value: string };

function safeTenantLink(webBaseUrl: string | undefined, companyId: string, path: string): string | undefined {
  if (!webBaseUrl || !path.startsWith('/') || path.startsWith('//') || /%2f|%5c/i.test(path)) return undefined;
  try {
    const relative = new URL(path, 'https://relative.invalid');
    const tenantRoot = `/companies/${encodeURIComponent(companyId)}`;
    if (relative.origin !== 'https://relative.invalid'
      || (relative.pathname !== tenantRoot && !relative.pathname.startsWith(`${tenantRoot}/`))) return undefined;
    const base = new URL(webBaseUrl);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return undefined;
    return new URL(`${relative.pathname}${relative.search}${relative.hash}`, `${base.origin}/`).toString();
  } catch {
    return undefined;
  }
}

function safeTenantUrl(webBaseUrl: string | undefined, companyId: string, value: string): string | undefined {
  if (!webBaseUrl) return undefined;
  try {
    const candidate = new URL(value);
    const base = new URL(webBaseUrl);
    if (candidate.origin !== base.origin) return undefined;
    return safeTenantLink(webBaseUrl, companyId, `${candidate.pathname}${candidate.search}${candidate.hash}`);
  } catch {
    return undefined;
  }
}

function bubble(
  card: LineAiAnswerCard,
  webBaseUrl: string | undefined,
  companyId: string,
  suppliedButtons?: SafeButton[],
  rows?: DetailRow[],
  language: LineReplyLanguage = lineReplyLanguage(card.text),
  keepCreditPhrase = false,
): Record<string, unknown> {
  // LINE refuses a message for one empty text or label, so a title or label of only spaces falls back too.
  const title = bounded(card.title ?? '', 80) || lineUiLabel('ข้อมูลจากน้องมั่งมี', language);
  const text = bounded(card.text, 1_200);
  const badge = bounded(card.badge ?? '', 40);
  const sources = (card.sourceLabels ?? []).map((label) => bounded(label, 60)).filter(Boolean).slice(0, 5);
  const link = card.webLink && safeTenantLink(webBaseUrl, companyId, card.webLink.path);
  const buttons = suppliedButtons ?? (link ? [{ label: bounded(card.webLink?.label ?? '', 40) || lineUiLabel('เปิดดูข้อมูล', language), uri: link }] : []);
  return {
    type: 'bubble',
    styles: {
      body: { backgroundColor: THEME.surface },
      footer: { separator: true, separatorColor: THEME.border },
    },
    header: {
      type: 'box', layout: 'vertical', backgroundColor: THEME.brandDark, paddingAll: '16px',
      contents: [{ type: 'text', text: title, color: THEME.surface, weight: 'bold', size: 'lg', wrap: !keepCreditPhrase,
        ...(keepCreditPhrase ? { adjustMode: 'shrink-to-fit' } : {}) }],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
      contents: [
        // §13: the state badge is its own row ABOVE the body, so the reader sees where the work
        // stands before reading anything else.
        ...(badge ? [{ type: 'text', text: badge, color: THEME.brandDark, weight: 'bold', size: 'sm', wrap: !keepCreditPhrase,
          ...(keepCreditPhrase ? { adjustMode: 'shrink-to-fit' } : {}) }] : []),
        // A row-only card passes no prose; LINE rejects an empty text element, so the row is omitted
        // rather than sent blank. Every prose caller passes non-empty text, so their bytes are unchanged.
        ...(text ? keepCreditPhrase && text.includes('เดือนนี้')
          ? [{ type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: text.slice(0, text.indexOf('เดือนนี้') + 'เดือนนี้'.length), color: THEME.text, size: 'md', wrap: false, adjustMode: 'shrink-to-fit' },
            { type: 'text', text: lineCustomerText(text.slice(text.indexOf('เดือนนี้') + 'เดือนนี้'.length)), color: THEME.text, size: 'md', wrap: true },
          ] }]
          : [{ type: 'text', text: lineCustomerText(text), color: THEME.text, size: 'md', wrap: true }] : []),
        ...(rows ?? []).map(({ label, value }) => ({
          type: 'box', layout: 'horizontal', spacing: 'sm',
          contents: [
            { type: 'text', text: bounded(label, 20), color: THEME.muted, size: 'sm', flex: 2, wrap: true },
            { type: 'text', text: bounded(value, 120), color: THEME.text, size: 'sm', weight: 'bold', flex: 5, wrap: true },
          ],
        })),
        ...(sources.length > 0
          ? [{ type: 'text', text: `${language === 'en' ? 'Sources' : 'แหล่งข้อมูล'}: ${sources.join(', ')}`, color: THEME.muted, size: 'xs', wrap: true }]
          : []),
      ],
    },
    ...(buttons.length > 0 ? {
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
        contents: buttons.map((button) => ({
          type: 'button', style: 'primary', color: THEME.brandDark,
          action: 'uri' in button
            ? { type: 'uri', label: bounded(button.label, 40), uri: button.uri }
            : 'data' in button
              ? { type: 'postback', label: bounded(button.label, 40), data: button.data }
              : { type: 'message', label: bounded(button.label, 40), text: button.text },
        })),
      },
    } : {}),
  };
}

/** Public policy uses the same card as assistant answers, without a tenant or model lookup.
 *  Owner 2026-09-30 (advisor spec §2.2): the answer leads to a person, not the public package page —
 *  its one button opens the company's official staff LINE, so no quick reply repeats it. */
export function buildPublicPolicyCardMessage(answer: PublicPolicyAnswer, language: LineReplyLanguage = 'th'): LineReplyMessage {
  answer = publicPolicyAnswerLanguage(answer, language);
  return {
    type: 'flex',
    altText: preview(answer.text, 400),
    canonicalText: answer.text,
    contents: bubble({ title: answer.title, text: answer.text }, undefined, '',
      [{ label: language === 'en' ? 'Contact staff' : STAFF_CONTACT_COMMAND, uri: STAFF_OA_URL }], undefined, language),
  };
}

function answerTopic(tools: readonly string[]): string {
  const topics = tools.map((name) => {
    if (name.startsWith('expense.')) return 'ค่าใช้จ่าย';
    if (name.startsWith('reimbursement.')) return 'ใบเบิก';
    if (name.startsWith('sales.')) return 'ยอดขาย';
    if (name.startsWith('inventory.')) return 'สต็อก';
    if (name.startsWith('crm.')) return 'ลูกค้า';
    if (name.startsWith('procurement.')) return 'งานจัดซื้อ';
    if (name.startsWith('tax.')) return 'ภาษี';
    if (name.startsWith('company.')) return 'บริษัท';
    if (name.startsWith('hr.') || name.startsWith('payroll.') || name.startsWith('leave.')) return 'งานบุคคล';
    if (name.startsWith('ledger.') || name.startsWith('accounting.') || name.startsWith('bank.') || name.startsWith('reports.')) return 'การเงิน';
    return '';
  });
  return new Set(topics).size === 1 ? topics[0]! : '';
}

function answerCardTitle(response: LineAiTurnResponse, language: LineReplyLanguage): string {
  if (language === 'en') return response.refused ? 'A note from Nong Mangmee' : 'Nong Mangmee’s answer';
  if (response.refused) return 'น้องมั่งมีแจ้งให้ทราบนะคะ';
  const topic = answerTopic(response.toolsInvoked);
  if (response.intent === 'read_summary' || response.intent === 'read_detail'
    || response.intent === 'report_request' || response.intent === 'sales_suggestion') return `น้องมั่งมีสรุป${topic}ให้นะคะ`;
  return 'น้องมั่งมีตอบให้นะคะ';
}

const MAX_BUTTON_LABEL = 40;
const UNNAMED_LINK_LABEL = 'เปิดดูในเว็บแอป';

/**
 * A body line that names its link — `ดาวน์โหลดเอกสาร:`, `เปิดตรวจสอบในเว็บ:` — is the label the
 * button should carry. Lifting the URL out without it left the naked colon line stranded in the body
 * and numbered the button `เปิดลิงก์ 1`, so a card with two links said nothing about either.
 *
 * `undefined` for anything that is not a short label, so ordinary prose is never mistaken for one.
 */
function labelFromLine(line: string): string | undefined {
  const trimmed = line.trim();
  // `เปิดดู: <name>` is how `completeAnswerText` writes the page a source opens: the name is the label.
  // Owner 2026-10-05, on a real answer with three such lines left on the card above "เปิดลิงก์ 1 / 2 / 3":
  // "ลิ้งชื่อปุ่ม ใช้ชื่อได้เลย ไม่ต้องบอกว่าปุ่มลิ้ง 1 2 3".
  const named = /^(?:เปิดดู|View):\s*(\S.*)$/u.exec(trimmed)?.[1];
  const label = named ?? (trimmed.endsWith(':') ? trimmed.slice(0, -1).trim() : '');
  return label && Array.from(label).length <= MAX_BUTTON_LABEL ? label : undefined;
}

/** The prose of a reply and its safe web links, each lifted out of the text with the label its line
 *  gave it. An unsafe or foreign link stays in the text exactly as it was written. */
function splitReplyLinks(text: string, webBaseUrl: string | undefined, companyId: string): { body: string; links: Array<{ uri: string; label?: string }> } {
  const links: Array<{ uri: string; label?: string }> = [];
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    const added: string[] = [];
    const remainder = line.replace(/https?:\/\/[^\s]+/gu, (candidate) => {
      const safe = safeTenantUrl(webBaseUrl, companyId, candidate);
      if (!safe) return candidate;
      if (!links.some((link) => link.uri === safe)) {
        links.push({ uri: safe });
        added.push(safe);
      }
      return '';
    });
    if (remainder === line) {
      kept.push(line);
      continue;
    }
    // A label belongs to exactly one link; two URLs on one line are left to the generic numbering.
    const target = added.length === 1 ? links.find((link) => link.uri === added[0]) : undefined;
    const inline = target && labelFromLine(remainder);
    if (inline) {
      target.label = inline;
      continue;
    }
    if (remainder.trim()) {
      kept.push(remainder);
      continue;
    }
    // `ดาวน์โหลดเอกสาร:` on its own line, with the URL on the next one.
    const previous = target && kept.length > 0 ? labelFromLine(kept[kept.length - 1]!) : undefined;
    if (previous && target) {
      kept.pop();
      target.label = previous;
    }
  }
  return { body: kept.join('\n').replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim(), links };
}

/** Deterministic replies (receipt/correction/reference) share the same card and link policy. */
export function buildLineAssistantTextCardMessage(
  text: string,
  webBaseUrl: string | undefined,
  companyId: string,
  badge?: string,
  title?: string,
  language: LineReplyLanguage = lineReplyLanguage(text),
): LineReplyMessage {
  title ??= lineUiLabel('ข้อมูลจากน้องมั่งมี', language);
  const { body, links } = splitReplyLinks(text, webBaseUrl, companyId);
  // A link nothing names says where it leads; it is never numbered (owner 2026-10-05).
  const buttons = links.map((link) => ({ label: link.label ?? lineUiLabel(UNNAMED_LINK_LABEL, language), uri: link.uri }));
  const cardText = body || (language === 'en' ? 'Open the details in the web app.' : 'เปิดดูรายละเอียดในเว็บแอป');
  const message: LineReplyMessage = {
    type: 'flex',
    altText: preview(cardText, 400) || 'ข้อมูลจากน้องมั่งมี',
    canonicalText: text,
    contents: bubble(
      { title, text: cardText, ...(badge ? { badge } : {}) },
      webBaseUrl, companyId, buttons, undefined, language,
    ),
  };
  // Nothing was cut: the prose is the body and every safe link is its own labelled button. A delivery
  // plan may then send this card itself, with the text as its fallback — the form production sent
  // (UAT 2026-09-29: the receipt reply had become a raw link with ids in plain text).
  if (Array.from(cardText).length <= ANSWER_CARD_BODY_LIMIT && Array.from(title).length <= ANSWER_CARD_TITLE_LIMIT
    && Array.from(badge ?? '').length <= ANSWER_CARD_BADGE_LIMIT) {
    completeBusinessAnswerPresentations.set(message, businessAnswerPresentationFingerprint(message)!);
  }
  return message;
}

const SYSTEM_CARD_ROW_LIMIT = 16;
const SYSTEM_CARD_LABEL_LIMIT = 40;
const SYSTEM_CARD_VALUE_LIMIT = 200;
const SYSTEM_CARD_NOTE_LIMIT = 4;
const SYSTEM_CARD_NOTE_CHARS = 600;
const within = (value: string, max: number) => Array.from(value).length <= max;
/** Nothing on a card of the locked design is ever cut: what does not fit is not drawn as that card. */
function systemCardHolds(rows: readonly LineSystemCardRow[], notes: readonly string[]): boolean {
  return rows.length <= SYSTEM_CARD_ROW_LIMIT && notes.length <= SYSTEM_CARD_NOTE_LIMIT
    && rows.every((row) => row.label.trim() && row.value.trim() && within(row.label, SYSTEM_CARD_LABEL_LIMIT) && within(row.value, SYSTEM_CARD_VALUE_LIMIT))
    && notes.every((note) => note.trim() && within(note, SYSTEM_CARD_NOTE_CHARS));
}

const HEADER_LINE_GRAPHEMES = 14;
const QUIET_HEADER_LINE_GRAPHEMES = 16;
/** More than both lines can ever show, so a message cut here is always a long one that ends in an ellipsis. */
const HEADER_READ_CHARS = 120;
const thaiWords = new Intl.Segmenter('th', { granularity: 'word' });
const thaiGraphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });
const graphemeCount = (value: string) => [...thaiGraphemes.segment(value.trim())].length;

// Thai is written without spaces, and the word list that finds its words cuts finer than a reader
// does: ค่า|ใช้|จ่าย, วัน|นี้, ใบ|เสร็จ. A heading broken there reads as a mistake, so a line never ends
// on a word that only begins a name, never starts with one that only ends a phrase, and never cuts
// the few names below. Not a grammar: a list of the breaks that looked wrong.
const NEVER_ENDS_A_LINE = new Set(['ค่า', 'ใบ', 'การ', 'ความ', 'ผู้', 'นัก', 'ราย', 'ยอด', 'เท่า', 'แจ้ง', 'ขั้น', 'อย่าง', 'รอ', 'ที่', 'ของ', 'ใน', 'กับ', 'และ', 'หรือ', 'จาก', 'ถึง', 'ไม่', 'จะ']);
const NEVER_STARTS_A_LINE = new Set(['นี้', 'นั้น', 'ๆ', 'ค่ะ', 'คะ', 'ครับ', 'จ้า', 'จ้ะ', 'นะ', 'จัง', 'เลย', 'ไหร่', 'ไร', 'ไง', 'หน่อย', 'ไป', 'มา']);
const KEPT_WHOLE = ['ค่าใช้จ่าย', 'ใช้จ่าย', 'เบิกจ่าย', 'ใบกำกับภาษี', 'แพ็กเกจ', 'เจ้าหน้าที่', 'ณ ที่จ่าย'];

/** The places a heading may be broken, as the two lines each break would give. */
function headerSplits(text: string): Array<readonly [string, string]> {
  const pieces = [...thaiWords.segment(text)];
  const kept = KEPT_WHOLE.flatMap((name) => [...text.matchAll(new RegExp(name, 'gu'))].map((match) => [match.index, match.index + name.length] as const));
  const splits: Array<readonly [string, string]> = [];
  const thai = /[\u0E00-\u0E7F]/u.test(text);
  for (let index = 1; index < pieces.length; index += 1) {
    const at = pieces[index]!.index, before = pieces[index - 1]!.segment, after = pieces[index]!.segment;
    if (kept.some(([start, end]) => at > start && at < end)) continue;
    // A number or code written without a space is one thing: "EXP-2026-000123" never breaks at its hyphens.
    if (/[A-Za-z0-9#/_.-]$/u.test(before) && /^[A-Za-z0-9#/_.-]/u.test(after)) continue;
    // A space the writer typed is a place to break — except, in a Thai sentence, between two words in
    // Latin letters ("service charge" is one name there). Elsewhere the two lists decide.
    if (thai && !before.trim() && /[A-Za-z]$/u.test(pieces[index - 2]?.segment ?? '') && /^[A-Za-z]/u.test(after)) continue;
    if (thai && !after.trim() && /[A-Za-z]$/u.test(before) && /^[A-Za-z]/u.test(pieces[index + 1]?.segment ?? '')) continue;
    if (before.trim() && after.trim() && (NEVER_ENDS_A_LINE.has(before) || NEVER_STARTS_A_LINE.has(after))) continue;
    const first = text.slice(0, at).trim(), second = text.slice(at).trim();
    if (first && second) splits.push([first, second]);
  }
  return splits;
}

/**
 * The two header lines of an answer: the reader's own words (design lock §7: the header says what
 * was answered; a short question may be the heading, a long one is shortened). A short message is
 * broken where its two lines come out most even; one that has no place to break stands under
 * `ข้อความของคุณ`; a long one keeps its beginning and ends in an ellipsis, in the quieter style.
 * Nothing is rephrased, so no heading can say something the reader did not.
 */
export function lineAnswerCardHeader(question: string | undefined): LineSystemCard['header'] | undefined {
  // A heading shows at most two short lines, so only the beginning of a long message is ever read:
  // finding the words of a 5,000-character message would cost seconds for letters nobody sees.
  const text = Array.from((question ?? '').replace(/\s+/gu, ' ').trim()).slice(0, HEADER_READ_CHARS).join('').trim();
  if (!text) return undefined;
  const splits = headerSplits(text);
  const even = splits.filter(([first, second]) => graphemeCount(first) <= HEADER_LINE_GRAPHEMES && graphemeCount(second) <= HEADER_LINE_GRAPHEMES)
    .sort((a, b) => Math.abs(graphemeCount(a[0]) - graphemeCount(a[1])) - Math.abs(graphemeCount(b[0]) - graphemeCount(b[1])))[0];
  if (even) return { lines: [even[0], even[1]], question: true };
  if (graphemeCount(text) <= HEADER_LINE_GRAPHEMES) return { lines: ['ข้อความของคุณ', text] };
  // The longest beginning that fits the first line, then as much of the rest as the second holds.
  const first = splits.filter(([line]) => graphemeCount(line) <= QUIET_HEADER_LINE_GRAPHEMES).at(-1);
  const cut = (value: string, max: number) => [...thaiGraphemes.segment(value)].slice(0, max).map((piece) => piece.segment).join('').trim();
  const head = first?.[0] ?? cut(text, QUIET_HEADER_LINE_GRAPHEMES);
  const rest = first?.[1] ?? text.slice(head.length).trim();
  // One unbroken word a little longer than a line (a record number): it stands whole under the
  // kicker, and the line shrinks to fit — the same place a short unbreakable message stands.
  if (!rest) return { lines: ['ข้อความของคุณ', head] };
  if (graphemeCount(rest) <= QUIET_HEADER_LINE_GRAPHEMES) return { lines: [head, rest], question: true, quiet: true };
  const tail = headerSplits(rest).filter(([line]) => graphemeCount(line) <= QUIET_HEADER_LINE_GRAPHEMES - 1).at(-1)?.[0] ?? cut(rest, QUIET_HEADER_LINE_GRAPHEMES - 1);
  return { lines: [head, `${tail}…`], question: true, quiet: true };
}

/** On a card the scope is a plain sentence — the design never prints the word "ขอบเขต" (lock §9). The
 *  canonical text keeps the line as it was written. Same words as the gateway's note for a row card. */
function withPlainScope(text: string): string {
  return text.replace(/^ขอบเขต:[ \t]*(?=เฉพาะ)/gmu, 'แสดง').replace(/^ขอบเขต:[ \t]*/gmu, '');
}

/**
 * A reply that is a sentence, on the locked design: two header lines, the sentence, and every safe web
 * link it carries as a button named by the line that carried it. `undefined` when this design cannot
 * carry the reply whole — no https base for the pictures, nothing to say, more links than a card
 * holds, or more text than one bubble may be — and the caller sends what it sent before. `text` stays
 * the canonical answer and the fallback; `paper` is what the card prints when that is not all of it.
 */
export function buildLineSystemTextCardMessage(input: {
  text: string;
  language?: LineReplyLanguage;
  /** The words drawn, when the canonical text has lines a card does not print (an answer's source line). */
  paper?: string;
  header: LineSystemCard['header'];
  webBaseUrl: string | undefined;
  companyId: string;
  textStyle?: LineSystemCard['textStyle'];
  icon?: LineSystemCardIcon;
  /** What a button says when the reply's own line did not name its link. */
  linkLabel?: string;
  footnotes?: readonly string[];
  action?: LineSystemCardAction;
}): LineReplyMessage | undefined {
  if (!lineSystemCardAvailable(input.webBaseUrl)) return undefined;
  const language = input.language ?? lineReplyLanguage(input.text);
  const { body, links } = splitReplyLinks(withPlainScope(input.paper ?? input.text), input.webBaseUrl, input.companyId);
  if (!body || links.length > LINE_SYSTEM_CARD_BUTTONS_MAX) return undefined;
  const buttons = links.map((link) => ({
    action: { type: 'uri' as const, label: bounded(link.label ?? input.linkLabel ?? lineUiLabel(UNNAMED_LINK_LABEL, language), MAX_BUTTON_LABEL), uri: link.uri },
    icon: input.icon ?? 'receipt' as const,
  }));
  if (input.action && buttons.length !== 1) return undefined;
  const contents = drawLineSystemCard({
    mascot: 'general', header: { ...input.header, lines: input.header.lines.map(line => lineUiLabel(line, language)) as [string, string] }, text: body, textStyle: input.textStyle ?? 'result',
    ...(input.footnotes?.length ? { footnotes: input.footnotes } : {}),
    // One link is the design's one button; several stand under one another, each with its own name.
    ...(input.action ? { choice: [input.action, buttons[0]!.action] as const }
      : buttons.length === 1 ? { button: buttons[0]! } : buttons.length ? { buttons } : {}),
  }, input.webBaseUrl);
  return contents && asCompleteLineCard({ type: 'flex', altText: preview(body, 400), canonicalText: input.text, contents });
}

/**
 * The receipt draft card (§10.1, locked design context 6 "รอตรวจสอบ"). Every row and note is a value the
 * capture ALREADY produced and the canonical reply already states; the reply's formatter builds both
 * from one reading of the record, and a fact it did not ground has no row.
 */
export type LineExpenseDraftCardFacts = {
  expenseId: string;
  /** The header's first line: what was captured (`ข้อมูลใบเสร็จ` for a receipt). The second is รอตรวจสอบ. */
  subject: string;
  rows: LineSystemCardRow[];
  notes: string[];
};

/** The record EXISTS but is unconfirmed — the same state the canonical reply's header prints
 *  ("บันทึก…เบื้องต้นแล้ว (รอตรวจสอบ)"), said once on the card, and never by a model. */
export const EXPENSE_DRAFT_CARD_NOTE = 'รายการนี้เป็นร่าง ยังไม่ได้ยืนยันรายการ';

/** The header's first line of the review card: a receipt is called a receipt, a typed note a draft,
 *  and any other paper simply a document — the row below it names the kind. */
export function expenseDraftCardSubject(sourceDocumentType: string | null | undefined, textOnly = false): string {
  return textOnly ? 'ร่างค่าใช้จ่าย' : sourceDocumentType === 'RECEIPT' ? 'ข้อมูลใบเสร็จ' : 'ข้อมูลเอกสาร';
}

/** What a producer of a draft's review card knows, each value already in the words it would print
 *  (a formatted date, an amount with its unit). A value that is missing or blank has no row. */
export type LineExpenseDraftCardValues = {
  expenseId: string;
  /** `ข้อมูลใบเสร็จ` for a receipt, `ข้อมูลเอกสาร` for another paper, `ร่างค่าใช้จ่าย` for a typed note. */
  subject: string;
  vendor?: string | null;
  item?: string | null;
  date?: string | null;
  documentNumber?: string | null;
  documentType?: string | null;
  category?: string | null;
  total?: string | null;
  vat?: string | null;
  withholdingTax?: string | null;
  otherCharges?: string | null;
  /** The record's own state in words (`EXPENSE_STATUS_LABELS`). */
  status: string;
  /** What the reply says before its facts, and after them; each is a note, word for word. */
  notesBefore?: ReadonlyArray<string | null | undefined>;
  notesAfter?: ReadonlyArray<string | null | undefined>;
};

/**
 * The review card's rows, in the locked design's order and under its names, for every producer of a
 * draft's card (the photo terminal, the file result): ONE place decides what a row is called and
 * where it stands, so two producers cannot draw the same record two ways. A value nobody grounded is
 * left out — never a placeholder. The state is always the last row, as a pending pill.
 */
export function expenseDraftCardFactsFrom(values: LineExpenseDraftCardValues): LineExpenseDraftCardFacts {
  const row = (label: string, value: string | null | undefined, extra: Partial<LineSystemCardRow> = {}): LineSystemCardRow[] =>
    value?.trim() && value.trim() !== '-' ? [{ label, value: value.trim(), ...extra }] : [];
  const notes = (entries: ReadonlyArray<string | null | undefined> = []) => entries.map((entry) => entry?.trim()).filter((entry): entry is string => !!entry);
  const vendor = values.vendor?.trim();
  return {
    expenseId: values.expenseId,
    subject: values.subject,
    rows: [
      ...row('ผู้ขาย / ร้านค้า', vendor),
      ...row('รายการ', values.item?.trim() !== vendor ? values.item : undefined),
      ...row('วันที่เอกสาร', values.date),
      ...row('เลขเอกสาร', values.documentNumber),
      ...row('ประเภทเอกสาร', values.documentType),
      ...row('หมวดค่าใช้จ่าย', values.category),
      ...row('ยอดรวม', values.total, { total: true }),
      ...row('VAT', values.vat),
      ...row('ภาษีหัก ณ ที่จ่าย', values.withholdingTax),
      ...row('ค่าบริการอื่นๆ', values.otherCharges),
      { label: 'สถานะเอกสาร', value: values.status, pill: 'pending' },
    ],
    notes: [...notes(values.notesBefore), EXPENSE_DRAFT_CARD_NOTE, ...notes(values.notesAfter)],
  };
}

/** §10.1: the capture terminal as the locked review card — the review mascot, the facts as
 *  `label : value` rows, the draft's notes, and the one button that opens the record for review.
 *
 *  `altText` stays the CANONICAL text, not a summary of the rows: it is what the chat list and the push
 *  notification show, and it is what the Flex→text fallback re-sends, so a downgraded delivery reads as
 *  the same words the plain-text reply carries. Same 400-character `preview` ceiling as every sibling
 *  card — a longer canonical text is VISIBLY marked, never silently cut.
 *
 *  Nothing grounded to show, no https base for the pictures, or a fact longer than a row holds is not
 *  this card: the generic text card is still the honest render of the same reply. */
export function buildExpenseDraftCardMessage(
  canonicalText: string,
  facts: LineExpenseDraftCardFacts,
  webBaseUrl: string | undefined,
  companyId: string,
  language: LineReplyLanguage = lineReplyLanguage(canonicalText),
): LineReplyMessage {
  return buildExpenseDraftReviewCard(canonicalText, facts, webBaseUrl, companyId, undefined, undefined, language) ?? buildLineAssistantTextCardMessage(canonicalText, webBaseUrl, companyId, undefined, undefined, language);
}

/** The review card alone: `undefined` where `buildExpenseDraftCardMessage` falls back to the text card. */
export function buildExpenseDraftReviewCard(
  canonicalText: string,
  facts: LineExpenseDraftCardFacts,
  webBaseUrl: string | undefined,
  companyId: string,
  confirmation?: ExpenseActionPreview,
  nextAction?: { label: string; text: string; data?: string },
  language: LineReplyLanguage = lineReplyLanguage(canonicalText),
): LineReplyMessage | undefined {
  const actionUrl = safeTenantLink(webBaseUrl, companyId, `/companies/${encodeURIComponent(companyId)}/expenses/${encodeURIComponent(facts.expenseId)}`);
  const rows = facts.rows.filter((row) => row.value.trim()).map(row => ({ ...row, label: lineUiLabel(row.label, language), value: ['สถานะเอกสาร', 'ประเภทเอกสาร'].includes(row.label) ? lineUiLabel(row.value, language) : row.value }));
  const notes = [...facts.notes.map(note => lineUiLabel(note, language)), ...(confirmation ? [[confirmation.summary, ...(confirmation.details ?? [])].join('\n')] : [])].filter((note) => note.trim());
  if (!actionUrl || rows.length === 0 || !systemCardHolds(rows, notes)) return undefined;
  const open = { type: 'uri' as const, label: lineUiLabel(confirmation?.documentImageUrl ? 'ส่งรูปเอกสาร' : 'เปิดดูในเว็บ', language), uri: actionUrl };
  const contents = drawLineSystemCard({
    mascot: 'review', header: { lines: [lineUiLabel(facts.subject, language), lineUiLabel('รอตรวจสอบ', language)] }, rows, notes,
    ...(nextAction || confirmation ? { choice: [nextAction ? nextAction.data ? { type: 'postback', label: nextAction.label, data: nextAction.data, displayText: nextAction.text }
      : { type: 'message', label: nextAction.label, text: nextAction.text } : { type: 'postback', label: lineUiLabel(confirmation!.evidenceReview ? 'ตรวจแล้ว ยืนยัน' : 'ยืนยันรายการ', language),
      data: lineControlData(new URLSearchParams({ action: 'expense_action_confirm', token: confirmation!.token }).toString(), language) }, open] as const }
      : { button: { icon: 'file' as const, action: open } }),
  }, webBaseUrl);
  return contents && asCompleteLineCard({
    type: 'flex',
    altText: preview(canonicalText, 400) || 'ร่างค่าใช้จ่าย',
    // The button as a line too: a text delivery still carries the way in.
    canonicalText: [canonicalText.includes(actionUrl) ? canonicalText : `${canonicalText}\n${language === 'en' ? 'View record' : 'เปิดดูรายการ'}: ${actionUrl}`,
      ...(confirmation ? [confirmation.summary, ...(confirmation.details ?? [])] : [])].join('\n'),
    contents,
  });
}

/** The first header line of every card that answers a photo or a file the reader sent: the words the
 *  locked scanning card already uses. The second line names the outcome; code picks it from the kind
 *  of reply, never a model, and it is never cut out of the reply's text (owner 2026-10-05). */
export const LINE_SENT_DOCUMENT_CARD_CONTEXT = 'เอกสารที่ส่งมา';

/**
 * What became of a photo or a file the reader sent: the second header line of the card that answers
 * it. Fixed words, one for each kind of outcome; the code that sends the reply says which kind it is.
 * Each must be true of every reply sent under it:
 *  - `kept`       the bytes are a bill already kept (the row card below);
 *  - `unread`     the document is kept or seen but its data could not be read — unclear, a failed read,
 *                 no reading credit, reading switched off;
 *  - `notExpense` the reader found something that is not a document of an expense, and nothing was kept;
 *  - `notTaken`   the document was not taken in at all: a right, a package, a quota, a failed download,
 *                 a refused file, a fault before anything was saved;
 *  - `question`   the system asks what the document is or what to do with it;
 *  - `reading`    the file is kept and being read; the result follows;
 *  - `stored`     the document is kept as what the reader sent it for, with nothing read out of it;
 *  - `result`     anything else that reports what the read found.
 */
export const LINE_SENT_DOCUMENT_OUTCOMES = {
  kept: 'ตรงกับบิลที่เก็บไว้แล้ว', unread: 'อ่านข้อมูลไม่ได้', notExpense: 'ไม่ใช่เอกสารค่าใช้จ่าย', notTaken: 'ยังรับเอกสารนี้ไม่ได้',
  question: 'ขอข้อมูลเพิ่ม', reading: 'กำลังอ่านเอกสาร', stored: 'เก็บไว้แล้ว', result: 'ผลการอ่านเอกสาร',
} as const;
export type LineSentDocumentOutcome = keyof typeof LINE_SENT_DOCUMENT_OUTCOMES;

/** What the reply "this picture is a bill already kept" is written from. A fact the record does not
 *  hold is left out: `total` is the amount with its unit, absent when the record has no amount yet. */
export type LineKeptReceiptFacts = { expenseId: string; vendor?: string | null; total?: string | null; progress: ReceiptProgress };

/**
 * A photo that is, byte for byte, a bill already kept (owner 2026-10-05: this reply was still on the
 * green card from before the design): a row card like the receipt review card. The seller, the total on
 * the emphasised row, the state the kept bill is in, what is left to do as a note, and the one button
 * that opens that bill. Rows come from the record's own facts, never read back out of the sentence;
 * `canonicalText` is the reply exactly as it was sent before — the fallback and the stored answer.
 *
 * `undefined` where the card cannot be drawn whole (no https base for the pictures, a fact longer than
 * a row holds, no page of this company to open): the caller sends the reply as it did before.
 */
export function buildKeptReceiptCard(
  canonicalText: string,
  facts: LineKeptReceiptFacts,
  webBaseUrl: string | undefined,
  companyId: string,
  readRetry?: LineSystemCardAction,
): LineReplyMessage | undefined {
  const actionUrl = safeTenantLink(webBaseUrl, companyId, `/companies/${encodeURIComponent(companyId)}/expenses/${encodeURIComponent(facts.expenseId)}`);
  const { state, next, tone } = facts.progress;
  const rows: LineSystemCardRow[] = [
    ...(facts.vendor?.trim() ? [{ label: 'ผู้ขาย', value: facts.vendor.trim() }] : []),
    ...(facts.total?.trim() ? [{ label: 'ยอดรวม', value: facts.total.trim(), total: true }] : []),
    // The state is a pill where a pill holds it whole; a longer one is printed as words, never cut.
    { label: 'สถานะ', value: state, ...(lineSystemCardPillHolds(state) ? { pill: tone } : {}) },
  ];
  const notes = next?.trim() ? [next.trim()] : [];
  if (!actionUrl || !systemCardHolds(rows, notes)) return undefined;
  const contents = drawLineSystemCard({
    mascot: 'general', header: { lines: [LINE_SENT_DOCUMENT_CARD_CONTEXT, LINE_SENT_DOCUMENT_OUTCOMES.kept] }, rows, notes,
    ...(readRetry ? { choice: [readRetry, { type: 'uri', label: 'เปิดใบเสร็จเดิม', uri: actionUrl }] as const }
      : { button: { action: { type: 'uri' as const, label: 'เปิดใบเสร็จเดิม', uri: actionUrl }, icon: 'receipt' as const } }),
  }, webBaseUrl);
  // The notification reads as it did: the reply without its link line.
  return contents && asCompleteLineCard({
    type: 'flex', altText: preview(splitReplyLinks(canonicalText, webBaseUrl, companyId).body, 400) || 'บิลที่เก็บไว้แล้ว', canonicalText, contents,
  });
}

/** Reimbursement intake, step one. Who paid decides the whole flow, so this card asks exactly that and
 *  nothing else: no link, no amounts, and no model text — the wording is owned here. */
export function buildReimbursementPayerClarificationMessage(language: LineReplyLanguage = 'th'): LineReplyMessage {
  if (language === 'en') {
    const text = 'Was this paid with your own money to claim back, or with shop funds?';
    return completeCard({ type: 'flex', altText: text, canonicalText: text, contents: bubble({ title: 'Who paid?', text }, undefined, '', [
      { label: 'Claim back', text: 'I paid personally and want to claim reimbursement' }, { label: 'Shop paid', text: 'The shop paid this expense' }]) }, text);
  }
  const text = [
    'รายการนี้ใครเป็นคนจ่ายคะ?',
    '• จ่ายเงินส่วนตัวไปก่อน แล้วต้องการเบิกคืนจากบริษัท',
    '• บริษัทเป็นผู้จ่ายเอง ไม่ต้องเบิกคืน',
    'พิมพ์ตอบกลับได้เลยค่ะว่า “เบิกคืน” หรือ “บริษัทจ่าย”',
  ].join('\n');
  return {
    type: 'flex',
    altText: preview(text, 400),
    canonicalText: text,
    contents: bubble({ title: 'น้องมั่งมีขอถามเพิ่ม', text }, undefined, '', []),
  };
}

/** Reimbursement intake, step two. Nothing is written from LINE; the web form is the only place the
 *  record is created, so the badge says so and the one button opens exactly that form — no query, no
 *  hash, no prefill. An untrusted base or a company id that cannot form a tenant path leaves the card
 *  without a button rather than with a guessed one. */
export function buildReimbursementHandoffMessage(webBaseUrl: string | undefined, companyId: string, language: LineReplyLanguage = 'th'): LineReplyMessage {
  if (language === 'en') {
    const text = 'No claim has been created; review the details and save it on the web.';
    const webLink = { label: 'Prepare claim', path: `/companies/${encodeURIComponent(companyId)}/reimbursements/new` };
    const link = safeTenantLink(webBaseUrl, companyId, webLink.path);
    return completeCard({ type: 'flex', altText: text, canonicalText: link ? `${text}\n${webLink.label}: ${link}` : text,
      contents: bubble({ title: 'Expense reimbursement', badge: 'Not created', text, webLink }, webBaseUrl, companyId) }, text);
  }
  const text = 'น้องมั่งมียังไม่ได้สร้างรายการเบิกคืนให้นะคะ '
    + 'กรุณาเปิดหน้าเว็บเพื่อตรวจสอบและกรอกรายละเอียดการเบิกคืนด้วยตนเอง '
    + 'ระบบจะสร้างรายการเมื่อกดบันทึกในเว็บเท่านั้นค่ะ';
  const webLink = { label: 'เปิดกรอกใบเบิกคืนในเว็บ', path: `/companies/${encodeURIComponent(companyId)}/reimbursements/new` };
  const link = safeTenantLink(webBaseUrl, companyId, webLink.path);
  return {
    type: 'flex',
    altText: preview(text, 400),
    // The button as a line, like the expense draft card: a text delivery still carries the way in.
    canonicalText: link ? `${text}\n${webLink.label}: ${link}` : text,
    contents: bubble({
      title: 'เบิกคืนค่าใช้จ่าย',
      badge: '📝 ยังไม่ได้สร้างรายการ',
      text,
      webLink,
    }, webBaseUrl, companyId),
  };
}

/** The one sentence both legal-gate reply paths carry. Kept verbatim as the card's altText so the
 *  chat-list preview, the push notification, and a Flex→text downgrade all read as the same words
 *  the old plain-text reply sent. */
export const LEGAL_ACCEPTANCE_REQUIRED_REPLY = '📄 กรุณาเข้าสู่เว็บแอป MangmeePlus เพื่อยอมรับข้อกำหนดการใช้งานและรับทราบนโยบายความเป็นส่วนตัวก่อนใช้งานบริการนี้นะคะ';

/** Legal-gate refusal card. The button opens the company home; the web session gate walks the user
 *  from there through the forced password change and the acceptance screen, so no deeper path is
 *  needed. The webhook lane wraps the URI into a one-tap login handoff at the delivery seam; the
 *  buffer pre-claim lane sends it plain, which still lands on the login page. No companyId (a
 *  pre-claim turn that resolved none) or an untrusted base leaves the card without a button, same
 *  policy as every sibling card. */
export function buildLegalAcceptanceRequiredMessage(
  webBaseUrl: string | undefined,
  companyId: string | undefined,
  language: LineReplyLanguage = 'th',
): LineReplyMessage {
  if (language === 'en') {
    const text = 'Your LINE account is linked; accept the terms and acknowledge the privacy policy in the web app before continuing here.';
    return completeCard({ type: 'flex', altText: text, canonicalText: text, contents: bubble({ title: 'Accept the terms', text,
      ...(companyId ? { webLink: { label: 'Review terms on web', path: `/companies/${encodeURIComponent(companyId)}` } } : {}) }, webBaseUrl, companyId ?? '') }, text);
  }
  const text = 'บัญชีของคุณผูก LINE เรียบร้อยแล้ว เหลืออีกขั้นเดียวค่ะ: เข้าเว็บแอป MangmeePlus '
    + 'เพื่อยอมรับข้อกำหนดการใช้งานและรับทราบนโยบายความเป็นส่วนตัว เสร็จแล้วกลับมาใช้งานผ่าน LINE ได้ทันทีนะคะ';
  return {
    type: 'flex',
    altText: preview(LEGAL_ACCEPTANCE_REQUIRED_REPLY, 400),
    contents: bubble({
      title: 'ยอมรับข้อกำหนดก่อนเริ่มใช้งาน',
      badge: '📄 รอยอมรับข้อกำหนด',
      text,
      ...(companyId ? {
        webLink: { label: 'เข้าเว็บแอปเพื่อยอมรับข้อกำหนด', path: `/companies/${encodeURIComponent(companyId)}` },
      } : {}),
    }, webBaseUrl, companyId ?? ''),
  };
}

/**
 * P10-L §3.1 — the three doors. Everyone who reaches the OA without an account sees exactly this
 * card, whether they typed something or just added the friend, so there is one answer to "what is
 * this and what do I do" instead of a dead end.
 *
 * A missing LIFF id (unconfigured env) drops that door rather than sending a broken link — the same
 * fail-open policy every other card here uses for an unusable URL.
 */
export function buildSignupDoorCard(liffId: string | undefined, webBaseUrl?: string, language: LineReplyLanguage = 'th'): LineReplyMessage {
  if (language === 'en') {
    const text = 'Welcome to MangmeePlus; choose how you would like to get started.';
    const linkUrl = existingAccountLinkUrl(webBaseUrl);
    return completeCard({ type: 'flex', altText: text, canonicalText: text, contents: bubble({ title: 'MangmeePlus ✅', badge: 'Verified official account', text }, undefined, '', [
      ...(liffId && LIFF_ID_PATTERN.test(liffId) ? [{ label: 'Register shop', uri: `https://liff.line.me/${liffId}/signup` }] : []),
      { label: 'Packages and prices', data: lineControlData('action=view-packages', language) },
      { label: 'I am an employee', data: lineControlData('action=employee-door', language) },
      ...(linkUrl ? [{ label: 'Link existing account', uri: linkUrl }] : []),
      { label: 'Contact team', uri: STAFF_OA_URL }]) }, text);
  }
  const liff = liffId && LIFF_ID_PATTERN.test(liffId) ? liffId : undefined;
  const text = 'สวัสดีค่ะ ยินดีต้อนรับสู่มั่งมีพลัส เลือกทางที่ตรงกับคุณได้เลยค่ะ';
  const linkUrl = existingAccountLinkUrl(webBaseUrl);
  return {
    type: 'flex',
    altText: preview(text, 400),
    contents: bubble(
      // Owner asked for the verified shield on this card (spec §9): it is the one card a stranger
      // sees, so it is the one place a fake OA would be imitating.
      { title: 'มั่งมีพลัส ✅', badge: 'บัญชีทางการที่ยืนยันแล้ว', text },
      undefined,
      '',
      [
        ...(liff ? [{ label: 'เปิดร้านใหม่', uri: `https://liff.line.me/${liff}/signup` }] : []),
        // Owner 2026-09-21: "how much is it" is the question a stranger asks before any door, and
        // until now the only way to ask it was the rich menu — which a follower has not opened yet.
        // The promotion card answers it and, for a stranger, carries the same เปิดร้านใหม่ door
        // back. The command CONSTANT, like every other message button here, so the label the
        // customer taps and the word the matcher answers cannot drift apart.
        { label: 'ดูแพ็กเกจและราคา', text: VIEW_PACKAGES_COMMAND },
        { label: EMPLOYEE_DOOR_COMMAND, text: EMPLOYEE_DOOR_COMMAND },
        ...(linkUrl ? [{ label: 'มีบัญชีอยู่แล้ว เชื่อม LINE', uri: linkUrl }] : []),
        // §7: the one door that reaches a person. Without it the keyword is typing-only and the
        // people most likely to need it are the ones least likely to guess it.
        { label: STAFF_CONTACT_COMMAND, uri: STAFF_OA_URL },
      ],
    ),
  };
}

/**
 * P12 link mode, NOT the LIFF account link-page: that page asks `getWatchDogToken()` for
 * `localStorage['watchdog_access_token']`, a key nothing in the product writes any more, so every
 * tap ended on "WatchDog session missing. Login to WatchDog first." — in English, on a Thai card.
 *
 * `line=link-required` is the notice `LoginPage` renders for exactly this case: sign in once with a
 * password and the page hands the browser back to LINE, which links the account. `next=/` because
 * the session gate resolves the company itself; a card is built before anyone is identified.
 * `openExternalBrowser=1` is added by the reply exit (`line-reply.adapter.ts`, R-B1), never here:
 * the login cookie still lands in the same browser that finishes the round trip.
 */
function existingAccountLinkUrl(webBaseUrl: string | undefined): string | undefined {
  if (!webBaseUrl) return undefined;
  try {
    const base = new URL(webBaseUrl);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return undefined;
    return `${base.origin}/login?line=link-required&next=%2F`;
  } catch {
    return undefined;
  }
}

/** Only what LINE itself accepts in a LIFF URL: `<channel digits>-<id>`. */
export const LIFF_ID_PATTERN = /^[0-9]{4,20}-[A-Za-z0-9]{1,32}$/;

/**
 * P10-L §3.1/§7. The door card becomes this one while an application is travelling: the same three
 * sentences the LIFF page shows, so the customer never gets two different answers to "where is it".
 */
export function buildSignupStatusCard(companyName: string, businessHours: boolean, language: LineReplyLanguage = 'th'): LineReplyMessage {
  if (language === 'en') {
    const text = `${companyName.trim() ? `${bounded(companyName, 60)}: ` : ''}Your registration is ${businessHours ? 'being reviewed' : 'queued for the next business day'}; our team works Monday–Saturday, 9:00–18:00 and will notify you here.`;
    return completeCard({ type: 'flex', altText: preview(text, 400), canonicalText: text, contents: bubble({ title: 'Registration received', text }, undefined, '',
      [{ label: 'Contact team', uri: STAFF_OA_URL }]) }, text);
  }
  const shop = companyName.trim() ? `ร้าน ${bounded(companyName, 60)} ` : '';
  // The bubble's own title already says "ได้รับคำขอแล้ว", so the body says what happens next and
  // does not repeat it — the same edit the LIFF waiting card took (Owner 2026-09-05).
  const text = businessHours
    ? `คำขอเปิด${shop}เข้าระบบแล้วค่ะ ทีมงานกำลังตรวจสอบ ปกติดำเนินการให้ภายในวันทำการ (จันทร์–เสาร์ 9:00–18:00) พร้อมเมื่อไหร่จะแจ้งในแชทนี้นะคะ`
    : `คำขอเปิด${shop}เข้าระบบแล้วค่ะ ตอนนี้อยู่นอกเวลาทำการ ทีมงานจะดูให้ในวันทำการถัดไป (จันทร์–เสาร์ 9:00–18:00) นะคะ`;
  return {
    type: 'flex',
    altText: preview(text, 400),
    contents: bubble(
      { title: 'ได้รับคำขอแล้ว', badge: '⏳ กำลังตรวจสอบ', text },
      undefined,
      '',
      // Waiting is exactly when someone wants a person, so this card carries the door too (§7).
      [{ label: STAFF_CONTACT_COMMAND, uri: STAFF_OA_URL }],
    ),
  };
}

/**
 * P10-L G-05. The monthly AI budget running out used to answer "กำลังประมวลผลข้อความก่อนหน้า",
 * which is not merely unhelpful — it invites the shop to send again, spending more. This says what
 * happened and offers the one action that fixes it.
 *
 * "ช่วงทดลอง" appears only for the trial tier; a paying shop is told about its package instead.
 */
export function buildAiBudgetExceededMessage(
  trialTier: boolean,
  refusal: { budgetErrorCode?: string; budgetScope?: AiBudgetScope } | undefined,
  canManagePlan: boolean,
  language: LineReplyLanguage = 'th',
  webBaseUrl?: string,
): LineReplyMessage {
  const en = language === 'en', insufficient = refusal?.budgetErrorCode === AI_BUDGET_REFUSAL_CODES.insufficient;
  const chat = refusal?.budgetScope === 'CHAT';
  const title = en ? `${chat ? 'Chat AI' : 'AI'} credit ${insufficient ? 'is insufficient' : 'used up this month'}`
    : chat ? `เครดิต AI ส่วนแชตเดือนนี้${insufficient ? 'เหลือไม่พอ' : 'หมดแล้ว'}` : `เครดิต AI เดือนนี้${insufficient ? 'เหลือไม่พอ' : 'หมดแล้ว'}`;
  const text = en ? chat
    ? 'Credit resets next month; changing packages does not refill this month’s chat credit, so contact the team to check special-deal eligibility.'
    : canManagePlan ? 'Credit resets next month, or change your package to continue.' : 'Credit resets next month; ask the shop owner or an authorized package manager for help.'
    : chat ? 'เดือนหน้าเริ่มใหม่ การเปลี่ยนแพ็กเกจไม่เติมเครดิตแชตในเดือนนี้ ติดต่อทีมงานเพื่อตรวจสิทธิ์ดีลพิเศษได้ค่ะ'
      : canManagePlan ? 'เดือนหน้าเริ่มใหม่ หรือเปลี่ยนแพ็กเกจเพื่อใช้ต่อได้ค่ะ' : `เดือนหน้าเริ่มใหม่ ${ASK_PLAN_MANAGER_TH}`;
  const actions: SafeButton[] = en ? chat ? [{ label: 'Contact team', uri: STAFF_OA_URL }]
    : canManagePlan ? [{ label: 'View packages', data: lineControlData('action=view-packages', language) }] : []
    : chat ? [{ label: STAFF_CONTACT_COMMAND, uri: STAFF_OA_URL }]
      : canManagePlan ? [{ label: 'ดูแพ็กเกจ', text: VIEW_PACKAGES_COMMAND }] : [];
  const canonicalText = `${title}\n${text}`;
  const designed = drawLineSystemCard({ mascot: 'general', header: { lines: [en ? 'Package' : 'แพ็กเกจ', title] }, text,
    ...(actions.length ? { buttons: actions.map(action => ({ icon: 'file' as const, action: 'data' in action ? { type: 'postback' as const, ...action }
      : 'text' in action ? { type: 'message' as const, ...action } : { type: 'uri' as const, ...action } })) } : {}),
  }, webBaseUrl);
  return completeCard({ type: 'flex', altText: preview(canonicalText, 400), canonicalText,
    contents: designed ?? bubble({ title, text }, undefined, '', actions, undefined, language) }, canonicalText);
}

/** Accepts only a handoff URL on our own web origin (`<web>/l/<token>`); anything else keeps the plain link. */
function oneTapPackageLink(webBaseUrl: string | undefined, candidate: string | undefined): string | undefined {
  if (!webBaseUrl || !candidate) return undefined;
  try {
    const base = new URL(webBaseUrl);
    const url = new URL(candidate);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return undefined;
    return url.origin === base.origin && url.pathname.startsWith(HANDOFF_PATH_PREFIX)
      && url.pathname.length > HANDOFF_PATH_PREFIX.length ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Spec J1/R14. The shop has no package that can be used, so the assistant answers ONE card and
 * nothing else — no router, no model, no OCR, and no price anywhere on LINE.
 *
 * Modelled on `buildAiBudgetExceededMessage`: say what happened, promise the data is safe, and
 * offer the one action that fixes it plus the door that reaches a person. The link is either the
 * lane's one-tap `/l/<token>` (R-B2) or built by `safeTenantLink`, so it can only ever point at
 * this web origin — the handoff page or this company's own web tenant.
 */
export function buildPackageRequiredMessage(input: {
  language?: LineReplyLanguage;
  lockReason: PlanTermLockReason;
  companyId: string;
  /** Absent when billing is closed or no web base is configured — the card then keeps only the
   *  staff door, which is still better than a link that goes nowhere. */
  webBaseUrl?: string;
  /** R-B2 (b): the `<web>/l/<token>` the lane minted before recording; must be on the web origin
   *  under `/l/`, otherwise the plain tenant link is used. */
  packageUrl?: string;
  /** The locked shop's own name (brand name preferred), so a reader with several shops knows which
   *  one this card is about. Absent falls back to the plain, shop-less text. */
  companyName?: string;
}): LineReplyMessage {
  const shop = input.companyName?.trim();
  if (input.language === 'en') {
    const text = `${shop ? `${shop}: ` : ''}Choose an active package before using the assistant; all your data is kept.`;
    const link = oneTapPackageLink(input.webBaseUrl, input.packageUrl) ?? safeTenantLink(input.webBaseUrl, input.companyId, `/companies/${encodeURIComponent(input.companyId)}/billing?channel=line`);
    return completeCard({ type: 'flex', altText: preview(text, 400), canonicalText: text, contents: bubble({ title: input.lockReason === 'no_package' ? 'No active package' : 'Package expired', text }, input.webBaseUrl, input.companyId,
      [...(link ? [{ label: 'Choose package', uri: link }] : []), { label: 'Contact team', uri: STAFF_OA_URL }]) }, text);
  }
  const text = `${shop ? `🏪 ${shop}\n` : ''}น้องมั่งมียังตอบไม่ได้จนกว่าจะเลือกแพ็กเกจค่ะ ข้อมูลทั้งหมดยังอยู่ครบ`;
  const link = oneTapPackageLink(input.webBaseUrl, input.packageUrl) ?? safeTenantLink(input.webBaseUrl, input.companyId,
    `/companies/${encodeURIComponent(input.companyId)}/billing?channel=line`);
  return {
    type: 'flex',
    altText: preview(text, 400),
    canonicalText: text,
    contents: bubble(
      {
        title: input.lockReason === 'no_package' ? 'ยังไม่มีแพ็กเกจ' : 'แพ็กเกจหมดอายุแล้ว',
        badge: '🔒 รอเลือกแพ็กเกจ',
        text,
      },
      input.webBaseUrl,
      input.companyId,
      [
        ...(link ? [{ label: 'เลือกแพ็กเกจ', uri: link }] : []),
        // §7: the one door that reaches a person, on the card the locked shop will keep seeing.
        { label: STAFF_CONTACT_COMMAND, uri: STAFF_OA_URL },
      ],
    ),
  };
}

/**
 * P10-L §3.6 "กันหลุด". The one nudge a LINE-only shop gets, on day 7 or after five reads. Both
 * buttons are postbacks: the answer is an intent, and neither belongs in the chat transcript as a
 * message the shop owner appears to have typed.
 */
export function buildProfileGuardNudgeCard(language: LineReplyLanguage = 'th'): LineReplyMessage {
  if (language === 'en') return { type: 'text', text: 'Add an email address or phone number on the web so you can recover shop access if your LINE account changes.', quickReply: { items: [ { type: 'action', action: { type: 'postback', label: 'Set recovery details', data: lineControlData('action=profile-guard', language) } }, { type: 'action', action: { type: 'postback', label: 'Later', data: lineControlData('action=profile-guard-later', language) } } ] } };
  const text = 'ใช้มาครบสัปดาห์แล้วค่ะ 👍 ใส่อีเมลหรือเบอร์ไว้หน่อยไหมคะ เผื่อเปลี่ยนมือถือแล้ว LINE หลุด จะได้กู้ร้านคืนได้';
  return {
    type: 'flex',
    altText: preview(text, 400),
    contents: bubble(
      { title: 'กันร้านหลุด', badge: '🔐 เผื่อเปลี่ยนมือถือ', text },
      undefined,
      '',
      [
        { label: PROFILE_GUARD_COMMAND, data: 'action=profile-guard' },
        { label: PROFILE_GUARD_LATER_COMMAND, data: 'action=profile-guard-later' },
      ],
    ),
  };
}

/**
 * Spec §3.7 / §7 row "ชนโควตา 15 ใบ" — the reply to the image that hit the monthly ceiling.
 *
 * The wording counts AI IMAGE READS, not receipts, because that is what `admitCompanyOcr` charges:
 * a signature photo or a picture sent with a question spends the same allowance a receipt does.
 * Both buttons send a text command rather than opening a URL: the shop owner is in the chat with a
 * photo they just sent, and "ดูแพ็กเกจ" is defined by the spec as a PULL of the promotion card that
 * already exists in this lane — a web link would leave the conversation to show the same thing.
 * The limit is passed in, never written into the sentence: a warm-up shop meets this wall at 10.
 * Advisor spec §2.2: the buttons only for a reader who may buy; `text` already says who to ask otherwise.
 */
export function buildReceiptQuotaExceededMessage(text: string, canManagePlan: boolean, language: LineReplyLanguage = 'th'): LineReplyMessage {
  if (language === 'en') {
    text = 'This month’s document-reading allowance is used up; enter the expense on the web or wait for the next cycle.';
    return completeCard({ type: 'flex', altText: text, canonicalText: text, contents: bubble({ title: 'Reading allowance used', text }, undefined, '',
      canManagePlan ? [{ label: 'View packages', data: lineControlData('action=view-packages', language) }, { label: 'Change package', data: lineControlData('action=package-change', language) }] : []) }, text);
  }
  return completeCard({
    type: 'flex',
    altText: preview(text, 400),
    // Required on a bound chat: its delivery plan refuses a card with no text form. With the proof
    // `completeCard` adds, the plan sends the card itself and keeps this sentence as the fallback.
    canonicalText: text,
    contents: bubble(
      { title: 'โควตาให้ AI อ่านรูปเดือนนี้ครบแล้ว', badge: '📄 ครบโควตาเดือนนี้', text },
      undefined,
      '',
      canManagePlan ? [
        { label: 'ดูแพ็กเกจ', text: VIEW_PACKAGES_COMMAND },
        { label: 'ขอเปลี่ยนแพ็กเกจ', text: PACKAGE_CHANGE_COMMAND },
      ] : [],
    ),
  }, text);
}

/** Every page an answer opens that this chat may open, each once, as `completeAnswerText` writes it. */
function answerLinkLines(response: LineAiTurnResponse, cards: LineAiAnswerCard[], webBaseUrl: string | undefined, companyId: string, language: LineReplyLanguage = lineReplyLanguage(response.replyText ?? '')): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const link of [...response.webLinks, ...cards.flatMap(card => card.webLink ? [card.webLink] : [])]) {
    const url = safeTenantLink(webBaseUrl, companyId, link.path);
    if (!url || seen.has(url)) continue;
    seen.add(url); const english = language === 'en';
    lines.push(`${english ? 'View' : 'เปิดดู'}: ${link.label.trim() || (english ? 'View details' : 'เปิดดูข้อมูล')} ${url}`);
  }
  return lines;
}

/** The whole answer as text — the canonical text: the reply, what its cards add, its sources and each page it opens. */
function completeAnswerText(response: LineAiTurnResponse, cards: LineAiAnswerCard[], webBaseUrl: string | undefined, companyId: string, language: LineReplyLanguage = lineReplyLanguage(response.replyText ?? '')): string {
  const parts: string[] = [];
  const blocks = new Set<string>();
  const append = (value: string | undefined) => {
    const text = value?.trim();
    if (text && !blocks.has(text)) { blocks.add(text); parts.push(text); }
  };
  append(response.replyText);
  for (const card of cards) { append(card.title); append(card.badge); append(card.text); }
  const sources = [...new Set([...response.sourceLabels, ...cards.flatMap(card => card.sourceLabels ?? [])].map(label => label.trim()).filter(Boolean))];
  if (sources.length) append(`${language === 'en' ? 'Sources' : 'แหล่งข้อมูล'}: ${sources.join(', ')}`);
  for (const line of answerLinkLines(response, cards, webBaseUrl, companyId, language)) append(line);
  return parts.join('\n\n');
}

/** What a prose card of the locked design prints of that answer: each sentence once, a card's title
 *  above its own text, and no line naming the sources (owner 2026-10-05: the card ends with the answer
 *  and its named buttons). The page lines stay, so that each becomes a button with its page's name. */
function answerPaperText(response: LineAiTurnResponse, cards: LineAiAnswerCard[], webBaseUrl: string | undefined, companyId: string, language: LineReplyLanguage = lineReplyLanguage(response.replyText ?? '')): string {
  const parts: string[] = [];
  const append = (value: string | undefined) => {
    const text = value?.trim();
    if (text && !parts.some((part) => part.includes(text))) parts.push(text);
  };
  // The reply leads unless a card already says it whole; then that card's own order stands.
  const reply = response.replyText.trim();
  if (!cards.some((card) => card.text.includes(reply))) append(reply);
  for (const card of cards) { append(card.title); append(card.badge); append(card.text); }
  return [...parts, ...answerLinkLines(response, cards, webBaseUrl, companyId, language)].join('\n\n');
}

function answerCardsCoverCompleteReply(response: LineAiTurnResponse, cards: LineAiAnswerCard[], webBaseUrl: string | undefined, companyId: string): boolean {
  if (!cards.length || cards.length > ANSWER_CARD_LIMIT) return false;
  for (const card of cards) {
    if (Array.from(card.text.trim()).length > ANSWER_CARD_BODY_LIMIT
      || card.title && Array.from(card.title.trim()).length > ANSWER_CARD_TITLE_LIMIT
      || card.badge && Array.from(card.badge.trim()).length > ANSWER_CARD_BADGE_LIMIT
      || (card.sourceLabels?.length ?? 0) > ANSWER_CARD_SOURCE_LIMIT
      || card.sourceLabels?.some(label => Array.from(label.trim()).length > ANSWER_CARD_SOURCE_LABEL_LIMIT)
      || card.webLink && (!safeTenantLink(webBaseUrl, companyId, card.webLink.path)
        || Array.from(card.webLink.label.trim()).length > MAX_BUTTON_LABEL)) return false;
  }
  const visibleText = cards.flatMap(card => [card.title?.trim(), card.text.trim()].filter((value): value is string => !!value)).join('\n');
  if (response.replyText.trim() && !visibleText.includes(response.replyText.trim())) return false;
  const visibleSources = new Set(cards.flatMap(card => card.sourceLabels ?? []).map(label => label.trim()));
  if (response.sourceLabels.some(label => !visibleSources.has(label.trim()))) return false;
  const visibleLinks = new Set(cards.flatMap(card => {
    const link = card.webLink && safeTenantLink(webBaseUrl, companyId, card.webLink.path);
    return link ? [link] : [];
  }));
  return response.webLinks.every(link => {
    const safe = safeTenantLink(webBaseUrl, companyId, link.path);
    return !safe || visibleLinks.has(safe);
  });
}

const LAYOUT_BUTTON_ICON: Record<Exclude<LineAiAnswerCardLayout['context'], 'edit_command'>, LineSystemCardIcon> = {
  expense_summary: 'receipt', open_work: 'list', expense_record: 'file', payment: 'receipt',
};

/** The answer cards the gateway structured, without a refused turn's. */
function answerCards(response: LineAiTurnResponse): LineAiAnswerCard[] {
  return !response.refused && response.presentation?.kind === 'answer_cards'
    ? response.presentation.cards.filter((card) => card.text.trim())
    : [];
}

/** The gateway's rows on the locked design, with every page the answer opens as a button named by
 *  what it opens. `undefined` when the design cannot hold them all — the answer is then its prose. */
function designedRowsBubble(
  layout: LineAiAnswerCardLayout & { context: Exclude<LineAiAnswerCardLayout['context'], 'edit_command'> },
  card: LineAiAnswerCard,
  response: LineAiTurnResponse,
  webBaseUrl: string,
  companyId: string,
): Record<string, unknown> | undefined {
  const rows = layout.rows.map((row) => ({ label: row.label, value: row.value, ...(row.emphasis ? { total: true } : {}), ...(row.tone ? { pill: row.tone } : {}) }));
  if (!systemCardHolds(rows, layout.notes ?? [])) return undefined;
  // The card's own page first, under the words the layout gives it; every other page under its own name.
  const own = card.webLink && safeTenantLink(webBaseUrl, companyId, card.webLink.path);
  // Rows that came with a page this chat may not open (another company's, or no page of the web app)
  // are not drawn: a card never promises a page it cannot open.
  if (card.webLink && !own) return undefined;
  const links: Array<{ uri: string; label: string }> = [];
  for (const link of [...(card.webLink ? [card.webLink] : []), ...response.webLinks]) {
    const uri = safeTenantLink(webBaseUrl, companyId, link.path);
    if (uri && !links.some((entry) => entry.uri === uri)) links.push({ uri, label: (uri === own && layout.linkLabel) || link.label.trim() || 'เปิดดูข้อมูล' });
  }
  // A name is never cut: one longer than a button holds leaves the answer to its prose, where it is printed whole.
  if (links.length > LINE_SYSTEM_CARD_BUTTONS_MAX || links.some((link) => !within(link.label, MAX_BUTTON_LABEL))) return undefined;
  const buttons = links.map((link) => ({ action: { type: 'uri' as const, label: link.label, uri: link.uri }, icon: LAYOUT_BUTTON_ICON[layout.context] }));
  return drawLineSystemCard({
    mascot: 'general', header: { lines: layout.header }, rows,
    ...(layout.banner ? { banner: layout.banner } : {}),
    ...(layout.notes ? { notes: layout.notes } : {}),
    ...(buttons.length === 1 ? { button: buttons[0]! } : buttons.length ? { buttons } : {}),
  }, webBaseUrl);
}

/**
 * A gateway answer on the locked System OA design. Rows when the gateway sent a layout for the whole
 * reply; otherwise the answer as prose under the reader's own question, every page it opens a button
 * with that page's name. `undefined` only when the design cannot show the answer at all — no https
 * base for the pictures, no words of the reader to head a prose answer, or more than one bubble may
 * hold — and the caller then sends the answer the way it did before the design.
 * `question` is the reader's own message; it heads an answer that has no structured layout.
 */
export function buildDesignedLineAnswerMessage(
  response: LineAiTurnResponse,
  fallbackText: string,
  webBaseUrl: string | undefined,
  companyId: string,
  question: string | undefined,
  language: LineReplyLanguage = lineReplyLanguage(question ?? response.replyText),
): LineReplyMessage | undefined {
  if (!lineSystemCardAvailable(webBaseUrl)) return undefined;
  const cards = answerCards(response);
  const canonicalText = completeAnswerText(response, cards, webBaseUrl, companyId, language) || fallbackText;
  // A layout stands for the whole reply or for nothing: it is honoured on the one card whose text IS the reply.
  const only = cards.length === 1 && cards[0]!.text.trim() === response.replyText.trim() ? cards[0]! : undefined;
  const layout = language === 'en' ? undefined : only && parseLineAiAnswerCardLayout(only.layout);
  if (only && layout && layout.context !== 'edit_command') {
    const contents = designedRowsBubble({ ...layout, context: layout.context }, only, response, webBaseUrl, companyId);
    if (contents) return asCompleteLineCard({ type: 'flex', altText: preview(fallbackText, 400) || 'ข้อมูลจากน้องมั่งมี', canonicalText, contents });
  }
  // Everything else is the answer's own sentences. The line naming its sources stays in the canonical
  // text and is not drawn (owner 2026-10-05: the card ends with the answer and its named buttons).
  const header = layout ? { lines: layout.header } : lineAnswerCardHeader(question);
  return header && buildLineSystemTextCardMessage({
    language, text: canonicalText, paper: answerPaperText(response, cards, webBaseUrl, companyId, language) || fallbackText,
    header, webBaseUrl, companyId, textStyle: layout ? 'result' : 'answer', icon: layout ? 'receipt' : 'file',
  });
}

/** Renderer only: presentation is structured by the trusted gateway; raw model Flex JSON is never accepted.
 *  The locked design first (`buildDesignedLineAnswerMessage`); below it is the reply as it was before the
 *  design, for everything the design cannot show whole. */
export function buildLineBusinessAnswerMessage(
  response: LineAiTurnResponse,
  fallbackText: string,
  webBaseUrl: string | undefined,
  companyId: string,
  question?: string,
  language: LineReplyLanguage = lineReplyLanguage(question ?? response.replyText),
): LineReplyMessage {
  if (language === 'en') {
    const sourceLabel = (label: string) => lineSourceLabel(label, response.sourceRefs.find(ref => ref.label === label)?.module, language);
    const link = (entry: NonNullable<LineAiTurnResponse['webLinks']>[number]) => ({ ...entry,
      label: lineSourceLabel(entry.label, response.sourceRefs.find(ref => ref.webPath === entry.path)?.module, language) });
    response = { ...response, sourceLabels: response.sourceLabels.map(sourceLabel), webLinks: response.webLinks.map(link),
      ...(response.presentation ? { presentation: { ...response.presentation, cards: response.presentation.cards.map(card => ({ ...card,
        ...(card.sourceLabels ? { sourceLabels: card.sourceLabels.map(sourceLabel) } : {}), ...(card.webLink ? { webLink: link(card.webLink) } : {}) })) } } : {}) };
  }
  const designed = buildDesignedLineAnswerMessage(response, fallbackText, webBaseUrl, companyId, question, language);
  if (designed) return designed;
  const cards = answerCards(response);
  const title = answerCardTitle(response, language);
  const canonicalText = completeAnswerText(response, cards, webBaseUrl, companyId, language);
  if (cards.length === 0) return buildLineAssistantTextCardMessage(canonicalText || fallbackText, webBaseUrl, companyId, undefined, title, language);
  if (!answerCardsCoverCompleteReply(response, cards, webBaseUrl, companyId)) return { type: 'text', text: canonicalText };

  const bubbles = cards.map((card) => bubble({ ...card, title: card.title?.trim() || title }, webBaseUrl, companyId, undefined, undefined, language));
  const message: LineReplyMessage = {
    type: 'flex',
    altText: preview(fallbackText, 400) || 'ข้อมูลจากน้องมั่งมี',
    canonicalText,
    contents: bubbles.length === 1 ? bubbles[0]! : { type: 'carousel', contents: bubbles },
  };
  completeBusinessAnswerPresentations.set(message, businessAnswerPresentationFingerprint(message)!);
  return message;
}


export const LINE_CLAIM_PICKER_COPY = {
  unavailable: 'ยังเปิดใบเบิกไม่ได้ค่ะ กดเปิดเมนูเพื่อลองอีกครั้ง',
  forbidden: 'ยังไม่มีสิทธิ์เปิดใบเบิกค่ะ ให้เจ้าของกิจการตรวจสิทธิ์ก่อน',
  choose: { reimbursement_submit: 'เลือกใบเบิกที่จะส่งอนุมัติค่ะ', reimbursement_cancel: 'เลือกใบเบิกที่จะยกเลิกค่ะ',
    approvals: 'เลือกใบเบิกที่จะอนุมัติค่ะ', reimbursement_reject: 'เลือกใบเบิกที่ไม่อนุมัติค่ะ', reimbursement_pay: 'เลือกใบเบิกที่จะบันทึกจ่ายคืนค่ะ' },
  empty: { reimbursement_submit: 'ยังไม่มีใบเบิกที่ส่งได้ค่ะ', reimbursement_cancel: 'ไม่พบใบเบิกที่ทำรายการนี้ได้ค่ะ',
    approvals: 'ไม่มีใบเบิกรอคุณอนุมัติค่ะ', reimbursement_reject: 'ไม่พบใบเบิกที่ทำรายการนี้ได้ค่ะ', reimbursement_pay: 'ยังไม่มีใบเบิกที่รอจ่ายค่ะ' },
  incomplete: 'มีรายการมากเกินจะค้นในแชตค่ะ', interrupted: 'ยังค้นใบเบิกไม่ครบค่ะ กดค้นในเว็บ',
};
export function buildClaimWorkflowPicker(result: LineWorkflowTargets, workflow: ClaimWorkflowId,
  secret: string, company: string, user: string, webBaseUrl = ''): LineReplyMessage {
  const text = !result.exhaustive ? result.total > 300 ? LINE_CLAIM_PICKER_COPY.incomplete : LINE_CLAIM_PICKER_COPY.interrupted
    : result.targets.length ? LINE_CLAIM_PICKER_COPY.choose[workflow] : LINE_CLAIM_PICKER_COPY.empty[workflow];
  const actions: LineSystemCardAction[] = result.targets.slice(0, 4).map((claim, index) => ({
    type: 'postback', label: `${(scrubRecordIdentifier(claim.requestNo, 30) ?? `ร่าง ${index + 1}`)} · ${formatClaimMoney(claim.amount, claim.currency, 'th')}`,
    data: lineWorkflowOpenData(secret, company, user, CLAIM_WORKFLOW_ACTIONS[workflow], claim.id),
  }));
  const webLabel = !result.exhaustive ? 'ค้นในเว็บ' : result.total > 4 ? 'ดูทั้งหมดในเว็บ' : 'เปิดในเว็บ';
  const exit: LineSystemCardAction = webBaseUrl ? { type: 'uri', label: webLabel,
    uri: `${webBaseUrl.replace(/\/$/, '')}/companies/${encodeURIComponent(company)}/reimbursements` }
    : { type: 'message', label: 'เปิดเมนู', text: 'เมนูหลัก' };
  if (!actions.length) return { type: 'text', text, quickReply: { items: [{ type: 'action', action: exit }] } };
  if (!result.exhaustive || result.total > 4) actions.push(exit);
  const canonicalText = [text, ...actions.map(action => action.label)].join('\n');
  const contents = drawLineSystemCard({ mascot: 'general', header: { lines: ['ใบเบิก', 'เลือกใบเบิก'] }, notes: [text],
    buttons: actions.map(action => ({ action, icon: 'file' as const })) }, webBaseUrl);
  return contents ? asCompleteLineCard({ type: 'flex', altText: text, canonicalText, contents })
    : { type: 'text', text: canonicalText, quickReply: { items: [{ type: 'action', action: exit }] } };
}
