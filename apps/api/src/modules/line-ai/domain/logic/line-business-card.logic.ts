import { DOCUMENT_DELIVERY_TOKEN_PATTERN, type LineAiAnswerCard, type LineAiTurnResponse } from '@watchdog-bms/contracts';
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

type SafeButton = { label: string; uri: string };

/**
 * Spec §12.5 — the ONE allowance beyond the tenant path: a `/d/{token}` delivery link, matched
 * exactly. The token shape is fixed (43 base64url characters), and the path must carry no query and
 * no fragment, so nothing that merely starts with `/d/` slips through. It is deliberately outside
 * `/companies/...`: the page it opens must stay unauthenticated, and living in the tenant path is
 * how such a page drifts into the authenticated shell.
 */
function isDeliveryLinkPath(url: URL): boolean {
  if (url.search || url.hash) return false;
  const token = url.pathname.startsWith('/d/') ? url.pathname.slice(3) : undefined;
  return !!token && DOCUMENT_DELIVERY_TOKEN_PATTERN.test(token);
}

function safeTenantLink(webBaseUrl: string | undefined, companyId: string, path: string): string | undefined {
  if (!webBaseUrl || !path.startsWith('/') || path.startsWith('//') || /%2f|%5c/i.test(path)) return undefined;
  try {
    const relative = new URL(path, 'https://relative.invalid');
    const tenantRoot = `/companies/${encodeURIComponent(companyId)}`;
    if (relative.origin !== 'https://relative.invalid'
      || (relative.pathname !== tenantRoot && !relative.pathname.startsWith(`${tenantRoot}/`) && !isDeliveryLinkPath(relative))) return undefined;
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
        { type: 'text', text, color: THEME.text, size: 'sm', wrap: true },
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
          action: { type: 'uri', label: bounded(button.label, 40), uri: button.uri },
        })),
      },
    } : {}),
  };
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
    altText: bounded(cardText, 400) || 'ข้อมูลจากน้องมั่งมี',
    contents: bubble(
      { title: 'ข้อมูลจากน้องมั่งมี', text: cardText, ...(badge ? { badge } : {}) },
      webBaseUrl, companyId, buttons,
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
  if (cards.length === 0) return buildLineAssistantTextCardMessage(fallbackText, webBaseUrl, companyId);

  const bubbles = cards.map((card) => bubble(card, webBaseUrl, companyId));
  return {
    type: 'flex',
    altText: bounded(fallbackText, 400) || 'ข้อมูลจากน้องมั่งมี',
    contents: bubbles.length === 1 ? bubbles[0]! : { type: 'carousel', contents: bubbles },
  };
}
