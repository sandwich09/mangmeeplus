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
 * Anything host-shaped: `https://a.b/c`, `www.a.b`, or a bare `a.b/c`. Deliberately wider than a
 * strict URL grammar — LINE auto-links bare domains, so a bare domain is a link to the person
 * reading it, whatever a parser would say.
 */
const HOST_SHAPED = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[:/?#]\S*)?/gi;

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

  for (const match of text.matchAll(HOST_SHAPED)) {
    const host = hostOf(match[0]);
    // An email address is not a link, and ours is the only one an operator would type; still, the
    // host rule decides it — `contact@mangmeeplus.com` passes because the host is ours.
    if (!allowedHosts.includes(host)) return { ok: false, reason: 'external_link', host };
  }
  return { ok: true, text };
}

function hostOf(token: string): string {
  return token
    .replace(/^https?:\/\//i, '')
    .split(/[:/?#]/)[0]!
    .toLowerCase();
}
