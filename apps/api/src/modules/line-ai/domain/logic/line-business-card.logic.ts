import { type LineAiAnswerCard, type LineAiTurnResponse } from '@watchdog-bms/contracts';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';

const THEME = {
  brand: '#22C55E',
  brandDark: '#15803D',
  text: '#1A2E22',
  muted: '#475467',
  border: '#E3EBE5',
  surface: '#FFFFFF',
} as const;

const bounded = (value: string, max: number) => Array.from(value.trim()).slice(0, max).join('');

/** altText is what the chat list and the push notification show. Cutting it at the limit with no mark
 *  ends the preview mid-syllable and reads as a broken message, so a truncated one says it is
 *  truncated. Grapheme-safe like `bounded`; the ellipsis is counted inside the limit. */
const preview = (value: string, max: number) => {
  const characters = Array.from(value.trim());
  return characters.length > max ? `${characters.slice(0, max - 1).join('')}…` : characters.join('');
};

/** A URI button, or one that sends a text command the webhook already answers (`โปรโมชั่น`). */
type SafeButton = { label: string; uri: string } | { label: string; text: string };

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
      type: 'box', layout: 'vertical', backgroundColor: THEME.brand, paddingAll: '16px',
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
        ...(text ? [{ type: 'text', text, color: THEME.text, size: 'sm', wrap: true }] : []),
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
            : { type: 'message', label: bounded(button.label, 40), text: button.text },
        })),
      },
    } : {}),
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
  return {
    type: 'flex',
    altText: preview(cardText, 400) || 'ข้อมูลจากน้องมั่งมี',
    contents: bubble(
      { title, text: cardText, ...(badge ? { badge } : {}) },
      webBaseUrl, companyId, buttons,
    ),
  };
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
  return {
    type: 'flex',
    altText: preview(canonicalText, 400) || 'ร่างค่าใช้จ่าย',
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
  return {
    type: 'flex',
    altText: preview(text, 400),
    contents: bubble({
      title: 'เบิกคืนค่าใช้จ่าย',
      badge: '📝 ยังไม่ได้สร้างรายการ',
      text,
      webLink: { label: 'เปิดกรอกใบเบิกคืนในเว็บ', path: `/companies/${encodeURIComponent(companyId)}/reimbursements/new` },
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

/** The command the webhook already answers with the promotion card (`staffMenuCommand` → `promotion`). */
const VIEW_PACKAGES_COMMAND = 'โปรโมชั่น';
/** TODO(L-B): wire this text (or a postback) to the package-change request use case the L-A branch
 *  added; until the dispatcher exists it falls through to the ordinary assistant turn. */
const PACKAGE_CHANGE_COMMAND = 'ขอเปลี่ยนแพ็กเกจ';

/**
 * Spec §3.7 / §7 row "ชนโควตา 15 ใบ" — the reply to the receipt that hit the monthly ceiling.
 *
 * Both buttons send a text command rather than opening a URL: the shop owner is in the chat with a
 * photo they just sent, and "ดูแพ็กเกจ" is defined by the spec as a PULL of the promotion card that
 * already exists in this lane — a web link would leave the conversation to show the same thing.
 * The limit is passed in, never written into the sentence: a warm-up shop meets this wall at 10.
 */
export function buildReceiptQuotaExceededMessage(text: string): LineReplyMessage {
  return {
    type: 'flex',
    altText: preview(text, 400),
    contents: bubble(
      { title: 'โควตาอ่านใบเสร็จเดือนนี้ครบแล้ว', badge: '📄 ครบโควตาเดือนนี้', text },
      undefined,
      '',
      [
        { label: 'ดูแพ็กเกจ', text: VIEW_PACKAGES_COMMAND },
        { label: 'ขอเปลี่ยนแพ็กเกจ', text: PACKAGE_CHANGE_COMMAND },
      ],
    ),
  };
}

/** Renderer only: presentation is structured by the trusted gateway; raw model Flex JSON is never accepted. */
export function buildLineBusinessAnswerMessage(
  response: LineAiTurnResponse,
  fallbackText: string,
  webBaseUrl: string | undefined,
  companyId: string,
): LineReplyMessage {
  const cards = !response.refused && response.presentation?.kind === 'answer_cards'
    ? response.presentation.cards.filter((card) => card.text.trim()).slice(0, 12)
    : [];
  const title = answerCardTitle(response);
  if (cards.length === 0) return buildLineAssistantTextCardMessage(fallbackText, webBaseUrl, companyId, undefined, title);

  const bubbles = cards.map((card) => bubble({ ...card, title: card.title?.trim() || title }, webBaseUrl, companyId));
  return {
    type: 'flex',
    altText: preview(fallbackText, 400) || 'ข้อมูลจากน้องมั่งมี',
    contents: bubbles.length === 1 ? bubbles[0]! : { type: 'carousel', contents: bubbles },
  };
}
