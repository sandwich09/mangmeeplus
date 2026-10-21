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
  // Owner 2026-10-21: the public home moved from official.mangmeeplus.com to the root of mangmeeplus.com.
  // That one page still opens inside LINE as before; every app page on the same host keeps opening outside.
  if ((host === 'mangmeeplus.com' || host === 'www.mangmeeplus.com') && parsed.pathname === '/') return false;
  return !SKIP_HOSTS.has(host) && !host.endsWith('.line.me');
}

export function hasLineExternalBrowserParam(url: string): boolean {
  return parse(url)?.searchParams.get(LINE_EXTERNAL_BROWSER_PARAM) === '1';
}

/**
 * Owner 2026-10-06: a web link in a LINE message opens the page already signed in. A sign-in token
 * cannot ride in a stored message (it dies in 15 minutes, a replay lands later), so the link goes
 * to the LIFF start page instead, which proves who tapped and mints the token AT the tap.
 * Set once at API boot; unset (specs, a deployment with no LIFF) keeps the plain link + param.
 */
let signedInOpen: { webOrigin: string; liffId: string } | null = null;

export function configureLineSignedInOpen(input: { webBaseUrl?: string | null; liffId?: string | null } | null): void {
  const origin = input?.webBaseUrl ? parse(input.webBaseUrl)?.origin : undefined;
  const liffId = input?.liffId ?? '';
  signedInOpen = origin && /^[0-9]{4,20}-[A-Za-z0-9]{1,32}$/.test(liffId) ? { webOrigin: origin, liffId } : null;
}

/** `https://liff.line.me/<id>/start?to=<path>` for a web-app page inside a company, else `null`. */
export function lineSignedInOpenUrl(url: string): string | null {
  const parsed = signedInOpen && parse(url);
  if (!signedInOpen || !parsed || parsed.origin !== signedInOpen.webOrigin || !parsed.pathname.startsWith('/companies/')) return null;
  const to = stripLineExternalBrowserParam(`${parsed.pathname}${parsed.search}${parsed.hash}`);
  return `https://liff.line.me/${signedInOpen.liffId}/start?to=${encodeURIComponent(to)}`;
}

export function withLineExternalBrowserParam(url: string): string {
  const signedIn = lineSignedInOpenUrl(url);
  if (signedIn) return signedIn;
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
