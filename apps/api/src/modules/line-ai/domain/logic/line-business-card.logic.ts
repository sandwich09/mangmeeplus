import type { LineAiAnswerCard, LineAiTurnResponse } from '@watchdog-bms/contracts';
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
): Record<string, unknown> {
  const title = bounded(card.title || 'ข้อมูลจากน้องมั่งมี', 80);
  const text = bounded(card.text, 1_200);
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

/** Deterministic replies (receipt/correction/reference) share the same card and link policy. */
export function buildLineAssistantTextCardMessage(
  text: string,
  webBaseUrl: string | undefined,
  companyId: string,
): LineReplyMessage {
  const links: string[] = [];
  const body = text.replace(/https?:\/\/[^\s]+/gu, (candidate) => {
    const safe = safeTenantUrl(webBaseUrl, companyId, candidate);
    if (!safe) return candidate;
    if (!links.includes(safe)) links.push(safe);
    return '';
  }).replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();
  const buttons = links.map((uri, index) => ({
    label: links.length === 1 ? 'เปิดดูในเว็บแอป' : `เปิดลิงก์ ${index + 1}`,
    uri,
  }));
  const cardText = body || 'เปิดดูรายละเอียดในเว็บแอป';
  return {
    type: 'flex',
    altText: bounded(cardText, 400) || 'ข้อมูลจากน้องมั่งมี',
    contents: bubble({ title: 'ข้อมูลจากน้องมั่งมี', text: cardText }, webBaseUrl, companyId, buttons),
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
