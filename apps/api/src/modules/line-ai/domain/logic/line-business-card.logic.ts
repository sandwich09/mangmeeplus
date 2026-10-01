import { AI_BUDGET_REFUSAL_CODES, type AiBudgetScope, type LineAiAnswerCard, type LineAiTurnResponse, type PlanTermLockReason } from '@watchdog-bms/contracts';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { lineMessagePreview as preview } from './line-message-preview.logic';
import {
  EMPLOYEE_DOOR_COMMAND,
  PACKAGE_CHANGE_COMMAND,
  STAFF_CONTACT_COMMAND,
  STAFF_OA_URL,
  PROFILE_GUARD_COMMAND,
  PROFILE_GUARD_LATER_COMMAND,
  VIEW_PACKAGES_COMMAND,
} from './line-staff-menu.logic';

import type { PublicPolicyAnswer } from './line-public-policy.logic';
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
): Record<string, unknown> {
  const title = bounded(card.title || 'ข้อมูลจากน้องมั่งมี', 80);
  const text = bounded(card.text, 1_200);
  const badge = bounded(card.badge ?? '', 40);
  const sources = (card.sourceLabels ?? []).map((label) => bounded(label, 60)).filter(Boolean).slice(0, 5);
  const link = card.webLink && safeTenantLink(webBaseUrl, companyId, card.webLink.path);
  const buttons = suppliedButtons ?? (link ? [{ label: bounded(card.webLink?.label || 'เปิดดูข้อมูล', 40), uri: link }] : []);
  return {
    type: 'bubble',
    styles: {
      body: { backgroundColor: THEME.surface },
      footer: { separator: true, separatorColor: THEME.border },
    },
    header: {
      type: 'box', layout: 'vertical', backgroundColor: THEME.brandDark, paddingAll: '16px',
      contents: [{ type: 'text', text: title, color: THEME.surface, weight: 'bold', size: 'lg', wrap: true }],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
      contents: [
        // §13: the state badge is its own row ABOVE the body, so the reader sees where the work
        // stands before reading anything else.
        ...(badge ? [{ type: 'text', text: badge, color: THEME.brandDark, weight: 'bold', size: 'sm', wrap: true }] : []),
        // A row-only card passes no prose; LINE rejects an empty text element, so the row is omitted
        // rather than sent blank. Every prose caller passes non-empty text, so their bytes are unchanged.
        ...(text ? [{ type: 'text', text, color: THEME.text, size: 'md', wrap: true }] : []),
        ...(rows ?? []).map(({ label, value }) => ({
          type: 'box', layout: 'horizontal', spacing: 'sm',
          contents: [
            { type: 'text', text: bounded(label, 20), color: THEME.muted, size: 'sm', flex: 2, wrap: true },
            { type: 'text', text: bounded(value, 120), color: THEME.text, size: 'sm', weight: 'bold', flex: 5, wrap: true },
          ],
        })),
        ...(sources.length > 0
          ? [{ type: 'text', text: `แหล่งข้อมูล: ${sources.join(', ')}`, color: THEME.muted, size: 'xs', wrap: true }]
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
export function buildPublicPolicyCardMessage(answer: PublicPolicyAnswer): LineReplyMessage {
  return {
    type: 'flex',
    altText: preview(answer.text, 400),
    canonicalText: answer.text,
    contents: bubble({ title: answer.title, text: answer.text }, undefined, '',
      [{ label: STAFF_CONTACT_COMMAND, uri: STAFF_OA_URL }]),
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

function answerCardTitle(response: LineAiTurnResponse): string {
  if (response.refused) return 'น้องมั่งมีแจ้งให้ทราบนะคะ';
  const topic = answerTopic(response.toolsInvoked);
  if (response.intent === 'read_summary' || response.intent === 'read_detail'
    || response.intent === 'report_request' || response.intent === 'sales_suggestion') return `น้องมั่งมีสรุป${topic}ให้นะคะ`;
  return 'น้องมั่งมีตอบให้นะคะ';
}

const MAX_BUTTON_LABEL = 40;

/**
 * A body line that names its link — `ดาวน์โหลดเอกสาร:`, `เปิดตรวจสอบในเว็บ:` — is the label the
 * button should carry. Lifting the URL out without it left the naked colon line stranded in the body
 * and numbered the button `เปิดลิงก์ 1`, so a card with two links said nothing about either.
 *
 * `undefined` for anything that is not a short label, so ordinary prose is never mistaken for one.
 */
function labelFromLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.endsWith(':')) return undefined;
  const label = trimmed.slice(0, -1).trim();
  return label && Array.from(label).length <= MAX_BUTTON_LABEL ? label : undefined;
}

/** Deterministic replies (receipt/correction/reference) share the same card and link policy. */
export function buildLineAssistantTextCardMessage(
  text: string,
  webBaseUrl: string | undefined,
  companyId: string,
  badge?: string,
  title = 'ข้อมูลจากน้องมั่งมี',
): LineReplyMessage {
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
  const body = kept.join('\n').replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();
  const buttons = links.map((link, index) => ({
    label: link.label ?? (links.length === 1 ? 'เปิดดูในเว็บแอป' : `เปิดลิงก์ ${index + 1}`),
    uri: link.uri,
  }));
  const cardText = body || 'เปิดดูรายละเอียดในเว็บแอป';
  const message: LineReplyMessage = {
    type: 'flex',
    altText: preview(cardText, 400) || 'ข้อมูลจากน้องมั่งมี',
    canonicalText: text,
    contents: bubble(
      { title, text: cardText, ...(badge ? { badge } : {}) },
      webBaseUrl, companyId, buttons,
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

/** §10.1 expense draft card facts. Every field is a value the capture ALREADY produced and the
 *  canonical reply already prints; the card re-uses them and never derives, formats up, or invents one.
 *  A fact the capture did not ground is left `undefined` so its row is simply absent. */
export type LineExpenseDraftCardFacts = {
  expenseId: string;
  amount?: string | null;
  item?: string | null;
  category?: string | null;
  status?: string | null;
};

const EXPENSE_DRAFT_CARD_ROWS = [
  ['amount', 'ยอดรวม'], ['item', 'รายการ'], ['category', 'หมวดหมู่'], ['status', 'สถานะ'],
] as const;

/** §10.1: the expense capture terminal gets its OWN card — amount, item, category and status each on
 *  their own row — instead of the generic card wrapping a canonical reply that its 1,200-character body
 *  would silently cut (§10.2). Only rows the capture actually grounded are drawn.
 *
 *  `altText` stays the CANONICAL text, not a summary of the rows: it is what the chat list and the push
 *  notification show, and it is what the Flex→text fallback re-sends, so a downgraded delivery reads as
 *  the same words the plain-text reply carries. Same 400-character `preview` ceiling as every sibling
 *  card — a longer canonical text is VISIBLY marked, never silently cut. */
export function buildExpenseDraftCardMessage(
  canonicalText: string,
  facts: LineExpenseDraftCardFacts,
  webBaseUrl: string | undefined,
  companyId: string,
): LineReplyMessage {
  const rows = EXPENSE_DRAFT_CARD_ROWS
    .map(([key, label]) => ({ label, value: (facts[key] ?? '').trim() }))
    .filter(({ value }) => value.length > 0);
  // Nothing grounded to show is not a card. The generic text card is still the honest render of the
  // same reply, so the turn degrades to it rather than shipping an empty ร่างค่าใช้จ่าย frame.
  if (rows.length === 0) return buildLineAssistantTextCardMessage(canonicalText, webBaseUrl, companyId);
  const actionUrl = safeTenantLink(webBaseUrl, companyId, `/companies/${encodeURIComponent(companyId)}/expenses/${encodeURIComponent(facts.expenseId)}`);
  const recoveryText = actionUrl && !canonicalText.includes(actionUrl) ? `${canonicalText}\nเปิดดูรายการ: ${actionUrl}` : canonicalText;
  return {
    type: 'flex',
    altText: preview(canonicalText, 400) || 'ร่างค่าใช้จ่าย',
    canonicalText: recoveryText,
    contents: bubble(
      {
        title: 'ร่างค่าใช้จ่าย',
        text: '',
        webLink: {
          label: 'เปิดตรวจสอบในเว็บ',
          path: `/companies/${encodeURIComponent(companyId)}/expenses/${encodeURIComponent(facts.expenseId)}`,
        },
      },
      webBaseUrl, companyId, undefined, rows,
    ),
  };
}

/** Reimbursement intake, step one. Who paid decides the whole flow, so this card asks exactly that and
 *  nothing else: no link, no amounts, and no model text — the wording is owned here. */
export function buildReimbursementPayerClarificationMessage(): LineReplyMessage {
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
export function buildReimbursementHandoffMessage(webBaseUrl: string | undefined, companyId: string): LineReplyMessage {
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
): LineReplyMessage {
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
export function buildSignupDoorCard(liffId: string | undefined, webBaseUrl?: string): LineReplyMessage {
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
        { label: STAFF_CONTACT_COMMAND, text: STAFF_CONTACT_COMMAND },
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
export function buildSignupStatusCard(companyName: string, businessHours: boolean): LineReplyMessage {
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
      [{ label: STAFF_CONTACT_COMMAND, text: STAFF_CONTACT_COMMAND }],
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
  /** The typed refusal, when the caller has one (spec §9.1). Absent ⇒ the legacy TOTAL-exhausted card. */
  refusal: { budgetErrorCode?: string; budgetScope?: AiBudgetScope } | undefined,
  /** The reader holds `company.plan.manage` (advisor spec §2.2). Only they get the package buttons. */
  canManagePlan: boolean,
): LineReplyMessage {
  // §9.1: money is LEFT — it just cannot cover this job's upper bound. Saying "ครบ/เต็ม" here would
  // be false, and the shop would stop trying smaller work that still fits.
  const insufficient = refusal?.budgetErrorCode === AI_BUDGET_REFUSAL_CODES.insufficient;
  // §9.2: a CHAT-bucket refusal names the chat part. It deliberately does NOT promise that receipts
  // still work — that needs the saved split policy AND current OCR eligibility, which no caller can
  // prove until §12 ships. Until then the card says less rather than something it cannot stand by.
  const chatOnly = refusal?.budgetScope === 'CHAT';
  const what = chatOnly ? 'เครดิต AI ส่วนแชตของเดือนนี้' : 'เครดิต AI ของเดือนนี้';
  // §2.2: whoever cannot buy is told who can, never offered a package action they cannot take.
  const next = canManagePlan ? ' หรือขอเปลี่ยนแพ็กเกจเพื่อใช้ต่อได้เลยนะคะ' : ` ${ASK_PLAN_MANAGER_TH}`;
  const text = insufficient
    ? `${chatOnly ? 'เครดิต AI ส่วนแชตที่เหลือ' : 'เครดิต AI ที่เหลือ'}ของเดือนนี้ไม่พอเริ่มงานนี้ค่ะ `
      + `${trialTier ? 'ช่วงทดลองมีเครดิต AI จำกัดต่อเดือน ' : ''}เดือนหน้าเริ่มใหม่`
      + `${chatOnly ? ' การเปลี่ยนแพ็กเกจไม่เติมเครดิตแชตในเดือนนี้ หากต้องการตรวจสอบสิทธิ์ดีลพิเศษ กรุณาติดต่อทีมงานค่ะ'
        : next}`
    : chatOnly
      ? `${what}หมดแล้วค่ะ เดือนหน้าเริ่มใหม่ การเปลี่ยนแพ็กเกจไม่เติมเครดิตแชตในเดือนนี้ `
        + 'หากต้องการตรวจสอบสิทธิ์ดีลพิเศษ กรุณาติดต่อทีมงานค่ะ'
    : trialTier
      ? `${what}หมดแล้วค่ะ ช่วงทดลองมีเครดิต AI จำกัดต่อเดือน เดือนหน้าเริ่มใหม่${next}`
      : `${what}หมดแล้วค่ะ เดือนหน้าเริ่มใหม่${next}`;
  const actions = chatOnly
    ? [{ label: STAFF_CONTACT_COMMAND, text: STAFF_CONTACT_COMMAND }]
    : canManagePlan ? [
      { label: 'ดูแพ็กเกจ', text: VIEW_PACKAGES_COMMAND },
      { label: PACKAGE_CHANGE_COMMAND, text: PACKAGE_CHANGE_COMMAND },
    ] : [];
  return completeCard({
    type: 'flex',
    altText: preview(text, 400),
    canonicalText: text,
      contents: bubble(
      insufficient
        ? { title: chatOnly ? 'เครดิต AI ส่วนแชตที่เหลือไม่พอ' : 'เครดิต AI เดือนนี้เหลือไม่พอ',
          badge: chatOnly ? '💚 เครดิต AI ส่วนแชตเหลือไม่พอเริ่มงาน' : '💚 เครดิต AI เหลือไม่พอเริ่มงาน', text }
        : { title: chatOnly ? 'เครดิต AI ส่วนแชตเดือนนี้หมดแล้ว' : 'เครดิต AI เดือนนี้หมดแล้ว', badge: '💚 เครดิต AI หมดเดือนนี้', text },
      undefined,
      '',
      actions,
    ),
  }, text);
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
        { label: STAFF_CONTACT_COMMAND, text: STAFF_CONTACT_COMMAND },
      ],
    ),
  };
}

/**
 * P10-L §3.6 "กันหลุด". The one nudge a LINE-only shop gets, on day 7 or after five reads. Both
 * buttons are postbacks: the answer is an intent, and neither belongs in the chat transcript as a
 * message the shop owner appears to have typed.
 */
export function buildProfileGuardNudgeCard(): LineReplyMessage {
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
export function buildReceiptQuotaExceededMessage(text: string, canManagePlan: boolean): LineReplyMessage {
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

function completeAnswerText(response: LineAiTurnResponse, cards: LineAiAnswerCard[], webBaseUrl: string | undefined, companyId: string): string {
  const parts: string[] = [];
  const blocks = new Set<string>();
  const append = (value: string | undefined) => {
    const text = value?.trim();
    if (text && !blocks.has(text)) { blocks.add(text); parts.push(text); }
  };
  append(response.replyText);
  for (const card of cards) { append(card.title); append(card.badge); append(card.text); }
  const sources = [...new Set([...response.sourceLabels, ...cards.flatMap(card => card.sourceLabels ?? [])].map(label => label.trim()).filter(Boolean))];
  if (sources.length) append(`แหล่งข้อมูล: ${sources.join(', ')}`);
  const links = [...response.webLinks, ...cards.flatMap(card => card.webLink ? [card.webLink] : [])];
  const seen = new Set<string>();
  for (const link of links) {
    const url = safeTenantLink(webBaseUrl, companyId, link.path);
    if (!url || seen.has(url)) continue;
    seen.add(url); append(`เปิดดู: ${link.label.trim() || 'เปิดดูข้อมูล'} ${url}`);
  }
  return parts.join('\n\n');
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

/** Renderer only: presentation is structured by the trusted gateway; raw model Flex JSON is never accepted. */
export function buildLineBusinessAnswerMessage(
  response: LineAiTurnResponse,
  fallbackText: string,
  webBaseUrl: string | undefined,
  companyId: string,
): LineReplyMessage {
  const cards = !response.refused && response.presentation?.kind === 'answer_cards'
    ? response.presentation.cards.filter((card) => card.text.trim())
    : [];
  const title = answerCardTitle(response);
  const canonicalText = completeAnswerText(response, cards, webBaseUrl, companyId);
  if (cards.length === 0) return buildLineAssistantTextCardMessage(canonicalText || fallbackText, webBaseUrl, companyId, undefined, title);
  if (!answerCardsCoverCompleteReply(response, cards, webBaseUrl, companyId)) return { type: 'text', text: canonicalText };

  const bubbles = cards.map((card) => bubble({ ...card, title: card.title?.trim() || title }, webBaseUrl, companyId));
  const message: LineReplyMessage = {
    type: 'flex',
    altText: preview(fallbackText, 400) || 'ข้อมูลจากน้องมั่งมี',
    canonicalText,
    contents: bubbles.length === 1 ? bubbles[0]! : { type: 'carousel', contents: bubbles },
  };
  completeBusinessAnswerPresentations.set(message, businessAnswerPresentationFingerprint(message)!);
  return message;
}
