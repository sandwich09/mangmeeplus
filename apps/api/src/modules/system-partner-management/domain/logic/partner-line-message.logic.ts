import { PARTNER_LINE_MESSAGE_MAX_LENGTH } from '@watchdog-bms/contracts';

/**
 * SEC-05. The admin message box is a push sent in the platform's own name into a customer's LINE
 * chat, where our OA is a Verified Account — so a link inside it inherits that trust. Anything that
 * is not our own web app or our own LIFF is refused here rather than explained away later.
 */
export type ShopMessageCheck =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'too_long' | 'external_link'; host?: string };

/** The one LINE host a message of ours may point at: every button we send is a central LIFF URL. */
export const LIFF_HOST = 'liff.line.me';

/**
 * Where a URL token ENDS. Whitespace is not enough, because the operator writes the whitespace:
 * `https://ours/x"https://evil.test/pay` is one `\S+` run, so it was judged once as our host and
 * sent — while every linkifier, LINE's included, renders the second URL live and tappable.
 *
 * So a token also ends at the characters that separate URLs in practice — quotes, angle brackets,
 * a backtick — and at the invisible ones an attacker would reach for next: the zero-width and
 * bidi-control class (U+200B–U+200F, U+2028/29, U+202A–U+202E, U+2060–U+2064, U+FEFF), which a
 * reader cannot see but a parser stops at.
 */
const TOKEN_END = '\\s"\'<>`\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u2064\\ufeff';

/**
 * An explicit link, taken whole up to the next terminator and handed to the URL parser — never
 * pattern-matched for its host, because `https://app.mangmeeplus.com:443@evil.test/pay` only reads
 * correctly through the same parser the tapper's browser uses.
 *
 * `*` rather than `+`: EVERY `https?://` in the text must produce a token, even a degenerate one
 * (a scheme glued straight onto a quote). A `+` here would silently skip it, which is the whole
 * class of bug this regex exists to close — a spec asserts the counts match.
 */
const SCHEME_URL = new RegExp(`https?://[^${TOKEN_END}]*`, 'gi');

/**
 * A bare host LINE auto-links for the reader (`a.b`, `www.a.b/c`), so it is a link whatever a
 * strict URL grammar would say. ASCII labels only: `\p{L}` here would match Thai prose around an
 * ordinary full stop and refuse honest sentences. An INTERNATIONALISED bare domain therefore is not
 * matched — but with a scheme it is, via `SCHEME_URL` above, which is how one would have to be
 * written to be tappable anyway.
 */
const BARE_HOST = new RegExp(`(?:[a-z0-9-]+\\.)+[a-z]{2,}(?:[:/?#][^${TOKEN_END}]*)?`, 'gi');

/** Dotted-quad; the bracketed IPv6 form is caught by the `[` prefix `new URL` leaves on it. */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Host of a configured base URL, lowercased and without a port. Unset/garbage yields nothing. */
export function baseUrlHost(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function shopMessageAllowedHosts(webBaseUrl: string | undefined): string[] {
  const web = baseUrlHost(webBaseUrl);
  return web ? [web, LIFF_HOST] : [LIFF_HOST];
}

/** Pure: no config, no clock. `allowedHosts` are exact hostnames, already lowercased. */
export function checkShopMessage(raw: string, allowedHosts: readonly string[]): ShopMessageCheck {
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > PARTNER_LINE_MESSAGE_MAX_LENGTH) return { ok: false, reason: 'too_long' };

  for (const token of [...text.matchAll(SCHEME_URL), ...text.matchAll(BARE_HOST)]) {
    const host = hostOf(token[0]);
    // Not parseable as a host at all — nothing a tap could reach, so nothing to fence.
    if (host === null) continue;
    // An IP literal is never one of ours by name, and treating one as "allowed" would depend on
    // WEB_BASE_URL happening to be an address rather than a name. Refused outright.
    if (isIpLiteral(host)) return { ok: false, reason: 'external_link', host };
    // An email address is not a link, and ours is the only one an operator would type; still, the
    // host rule decides it — `contact@app.mangmeeplus.com` passes because the host is ours.
    if (!allowedHosts.includes(host)) return { ok: false, reason: 'external_link', host };
  }
  return { ok: true, text };
}

/**
 * The host a TAP actually reaches, decided by the same parser the reader's browser uses.
 *
 * Splitting this by hand is how the first version shipped a bypass: `app.mangmeeplus.com:443@evil.
 * test/pay` reads as our host to a regex that stops at the first `:`, and as `evil.test` to every
 * browser and to LINE. Userinfo, ports, trailing dots and IDN → punycode are all this function's
 * job, and `new URL` already does all four correctly.
 */
function hostOf(token: string): string | null {
  const candidate = /^https?:\/\//i.test(token) ? token : `https://${token}`;
  try {
    // `hostname` is already lower-cased and punycode-encoded; only the root dot is left to strip.
    return new URL(candidate).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

/**
 * How many `https?://` tokens the fence actually judges in a string. Exported for the spec that
 * pins the invariant: this must equal the number of `https?://` occurrences, or some link in the
 * text was never looked at.
 */
export function countJudgedSchemeTokens(text: string): number {
  return [...text.matchAll(SCHEME_URL)].length;
}

function isIpLiteral(hostname: string): boolean {
  return IPV4.test(hostname) || hostname.startsWith('[');
}
