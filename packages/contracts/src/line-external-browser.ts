// Spec: docs/specs/mangmee-purchase-without-setup-spec-th.md §7-B R-B1 / §18.2 R-B1 (Owner D-PF-2).
// Applied at the three legacy LINE send boundaries — never in a message builder — so retry keys
// (line-reply.adapter.ts linePushRetryKey), stored outcomes and notification binding hashes keep
// the plain bytes; and once where a delivery plan v2 is frozen (line-delivery-plan.logic.ts
// buildLineDeliveryPlan/freeze), BEFORE its wireHash/pushRetryKey, so a frozen plan stores, sends
// and replays one byte sequence. A deterministic, idempotent rewrite either way.

export const LINE_EXTERNAL_BROWSER_PARAM = 'openExternalBrowser';
export const LINE_TEXT_MESSAGE_MAX_CHARS = 5000;
export const LINE_URI_ACTION_MAX_CHARS = 1000;
/** Stays inside LINE: LIFF pages, LINE deep links (add-friend), and the official site is not the app. */
const SKIP_HOSTS: ReadonlySet<string> = new Set(['liff.line.me', 'line.me', 'lin.ee', 'official.mangmeeplus.com']);
/** Absolute http(s) URLs in free text, stopped where LINE's linkifier stops (line-handoff-link.service.ts:17). */
const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]}]+/g;
/** Sentence punctuation or Thai text typed straight after a link belongs to the sentence, not the link
 *  (`)` never gets this far: URL_PATTERN already stops before it). */
const URL_TRAILER = /[.,”฀-๿]+$/;

function parse(url: string): URL | null { try { return new URL(url); } catch { return null; } }

export function shouldOpenOutsideLine(url: string): boolean {
  const parsed = parse(url);
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return false;
  const host = parsed.hostname.toLowerCase();
  return !SKIP_HOSTS.has(host) && !host.endsWith('.line.me');
}

export function hasLineExternalBrowserParam(url: string): boolean {
  return parse(url)?.searchParams.get(LINE_EXTERNAL_BROWSER_PARAM) === '1';
}

export function withLineExternalBrowserParam(url: string): string {
  if (!shouldOpenOutsideLine(url) || hasLineExternalBrowserParam(url)) return url;
  const hashAt = url.indexOf('#');
  const head = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const fragment = hashAt >= 0 ? url.slice(hashAt) : '';
  return `${head}${head.includes('?') ? '&' : '?'}${LINE_EXTERNAL_BROWSER_PARAM}=1${fragment}`;
}

export function stripLineExternalBrowserParam(pathOrUrl: string): string {
  const relative = pathOrUrl.startsWith('/');
  const parsed = parse(relative ? `https://relative.invalid${pathOrUrl}` : pathOrUrl);
  if (!parsed || !parsed.searchParams.has(LINE_EXTERNAL_BROWSER_PARAM)) return pathOrUrl;
  parsed.searchParams.delete(LINE_EXTERNAL_BROWSER_PARAM);
  const rest = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return relative ? rest : `${parsed.origin}${rest}`;
}

/** Over `maxChars` the text stays as it was — never a link cut in half. The v2 plan passes Infinity. */
export function withLineExternalBrowserText(text: string, maxChars: number = LINE_TEXT_MESSAGE_MAX_CHARS): string {
  const out = text.replace(URL_PATTERN, (match) => {
    // The param goes on the link and the trailer stays after it: "…/billing." must not become "…/billing.?…".
    const trailer = URL_TRAILER.exec(match)?.[0] ?? '';
    return `${withLineExternalBrowserParam(match.slice(0, match.length - trailer.length))}${trailer}`;
  });
  return out.length <= maxChars ? out : text;
}

function rewriteNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    const items = node.map(rewriteNode);
    return items.some((item, index) => item !== node[index]) ? items : node;
  }
  if (!node || typeof node !== 'object') return node;
  const source = node as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  if (source['type'] === 'uri' && typeof source['uri'] === 'string') {
    const uri = withLineExternalBrowserParam(source['uri']);
    if (uri !== source['uri'] && uri.length <= LINE_URI_ACTION_MAX_CHARS) next = { ...source, uri };
  }
  for (const [key, value] of Object.entries(source)) {
    if (!value || typeof value !== 'object') continue;
    const rewritten = rewriteNode(value);
    if (rewritten !== value) { next ??= { ...source }; next[key] = rewritten; }
  }
  return next ?? node;
}

type LineWireMessage = { type?: unknown; text?: unknown; contents?: unknown };

export function withLineExternalBrowserLinks<T>(messages: readonly T[]): T[] {
  const out = messages.map((message) => {
    const wire = message as LineWireMessage | null;
    if (!wire || typeof wire !== 'object') return message;
    if (wire.type === 'text' && typeof wire.text === 'string') {
      const text = withLineExternalBrowserText(wire.text);
      return text === wire.text ? message : ({ ...(wire as object), text } as T);
    }
    if (wire.type === 'flex' && wire.contents && typeof wire.contents === 'object') {
      const contents = rewriteNode(wire.contents);
      return contents === wire.contents ? message : ({ ...(wire as object), contents } as T);
    }
    return message;
  });
  return out.some((item, index) => item !== messages[index]) ? out : (messages as T[]);
}
