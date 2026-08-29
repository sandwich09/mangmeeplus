export type ClientSupport = 'supported' | 'unsupported' | 'unknown';

const MINIMUM_IOS = [16, 4] as const;
const MINIMUM_BROWSER_MAJOR = 111;

function compareVersion(actual: readonly number[], minimum: readonly number[]): number {
  const length = Math.max(actual.length, minimum.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (actual[index] ?? 0) - (minimum[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function browserMajor(userAgent: string): number | null {
  // Chromium Edge UAs also carry a Chrome token; brand precedence must beat token position.
  for (const pattern of [/(?:EdgA?|Edge)\/(\d+)/i, /(?:Firefox|FxiOS)\/(\d+)/i, /(?:Chrome|CriOS)\/(\d+)/i]) {
    const match = userAgent.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

/** Conservative support classification: only positively recognized old clients are blocked. */
export function classifyWebClient(userAgent: string | null | undefined): ClientSupport {
  if (!userAgent || /bot|crawler|spider|slurp|headless/i.test(userAgent)) return 'unknown';

  const isIos = /(?:iPhone|iPad|iPod)/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && /Mobile\//i.test(userAgent));
  if (isIos) {
    const osMatch = userAgent.match(/(?:CPU(?: iPhone)? )?OS (\d+)[._](\d+)/i);
    const safariMatch = userAgent.match(/Version\/(\d+)\.(\d+)/i);
    const version = osMatch ?? safariMatch;
    if (!version) return 'unknown';
    return compareVersion([Number(version[1]), Number(version[2])], MINIMUM_IOS) < 0
      ? 'unsupported'
      : 'supported';
  }

  const androidMatch = userAgent.match(/Android\s+(\d+)(?:\.(\d+))?/i);
  if (androidMatch) {
    if (Number(androidMatch[1]) < 10) return 'unsupported';
    const major = browserMajor(userAgent);
    if (major === null) return 'unknown';
    return major < MINIMUM_BROWSER_MAJOR ? 'unsupported' : 'supported';
  }

  const major = browserMajor(userAgent);
  if (major !== null) return major < MINIMUM_BROWSER_MAJOR ? 'unsupported' : 'supported';

  if (/Safari\//i.test(userAgent)) {
    const match = userAgent.match(/Version\/(\d+)\.(\d+)/i);
    if (!match) return 'unknown';
    return compareVersion([Number(match[1]), Number(match[2])], MINIMUM_IOS) < 0
      ? 'unsupported'
      : 'supported';
  }

  return 'unknown';
}

const EXEMPT_PATHS = ['/privacy', '/terms', '/data-deletion', '/maintenance', '/unsupported-browser'];
const STATIC_FILE = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|png|svg|txt|webmanifest|webp|woff2?)$/i;

export function isCompatibilityExemptPath(pathname: string): boolean {
  return pathname === '/api'
    || pathname.startsWith('/api/')
    // P12-3b: `/l/<token>` is a route handler, and the notice would redirect it to
    // `/unsupported-browser?next=/l/<token>` — an HTML page carrying a bearer token in its URL,
    // which the handoff spec forbids outright. Exempting it costs the user nothing: the exchange
    // 303s to the real destination, and the notice fires there instead, on a safe URL.
    || pathname.startsWith('/l/')
    || pathname.startsWith('/legal/releases/')
    || EXEMPT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
    || STATIC_FILE.test(pathname);
}

export function shouldShowCompatibilityNotice(input: {
  pathname: string;
  method: string;
  accept: string | null;
  fetchDestination: string | null;
  userAgent: string | null;
}): boolean {
  if (input.method !== 'GET' && input.method !== 'HEAD') return false;
  if (isCompatibilityExemptPath(input.pathname)) return false;
  if (input.fetchDestination && input.fetchDestination !== 'document') return false;
  if (input.accept && !input.accept.toLowerCase().includes('text/html')) return false;
  return classifyWebClient(input.userAgent) === 'unsupported';
}
