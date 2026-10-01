import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { forwardedClientHeaders } from '@/common/api/forwarded-client-headers';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { generateCsrfToken, setAuthCookies } from '@/common/auth/auth-cookies.server';
import { publicOriginFromHeaders, sanitizeReturnTo } from '@/features/auth/line-login-bff.logic';

/** Same shape the API mints. Anything outside it never reaches a query (P12-3b spec §11). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

type HandoffExchangeResult = {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  companyId?: string;
  targetPath?: string;
};

/** A refusal for a token the API recognised carries the destination the user was trying to open. */
type HandoffRefusal = { targetPath?: unknown };

// Static, self-contained recovery: no scripts, assets, upstream error text or token in the body.
// An explicit GET retries this URL; never replay a single-use exchange automatically.
function unavailable() {
  // The proxy can overwrite response CSP, so the document also enforces this stricter policy.
  const csp = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'";
  return new Response(`<!doctype html><html lang="th"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>เปิดลิงก์ไม่สำเร็จชั่วคราว</title>
<style>body{font-family:system-ui,sans-serif;margin:3rem 1.5rem;color:#172c22}main{max-width:36rem;margin:auto}h1{font-size:1.5rem}button{font:inherit;min-height:44px;padding:.5rem 1.5rem;cursor:pointer}</style>
<body><main><h1>เปิดลิงก์ไม่สำเร็จชั่วคราว</h1>
<p>ระบบขัดข้องชั่วคราว กรุณารอสักครู่แล้วลองอีกครั้ง</p>
<form method="get"><button type="submit">ลองอีกครั้ง</button></form></main></body></html>`, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '10',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `${csp}; frame-ancestors 'none'`,
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/**
 * Link previews and reachability probes send HEAD. Next.js would otherwise derive HEAD from GET and
 * RUN it — spending the single-use token before the person taps (deeplink spec §G7, RV22). 204 and
 * nothing else: the token never reaches the API on a HEAD.
 */
export function HEAD() {
  return new Response(null, { status: 204 });
}

/**
 * P12-3b: the LINE deep-link entry point.
 *
 * A route handler: exchanges redirect; transient failures serve only the isolated recovery above,
 * whose CSP blocks subresources and whose referrer policy prevents token leakage. It sits outside
 * `/companies/`, so the middleware's cookie-less bounce
 * does not intercept the one request whose entire purpose is arriving without a session.
 *
 * The exchange is spent server-side and its tokens become the same httpOnly cookies password login
 * sets. Those cookies REPLACE whatever session the browser held — which is the defect this feature
 * exists to fix: a link opened in a browser signed in as somebody else used to render
 * "ไม่สามารถเข้าถึงบริษัทนี้ได้" with no way out. The previous session is replaced here, not revoked
 * on the server, because it may belong to a second real person on a shared device (spec §7).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const origin = publicOriginFromHeaders(request.headers, request.nextUrl.origin);
  const expired = (targetPath?: string) => {
    const next = sanitizeReturnTo(targetPath);
    // One notice channel for every LINE outcome — the existing `line=` parameter the login page
    // already renders — rather than a second, parallel `reason=` mechanism.
    const query = next ? `?line=handoff-expired&next=${encodeURIComponent(next)}` : '?line=handoff-expired';
    return NextResponse.redirect(new URL(`/login${query}`, origin), 303);
  };

  const { token } = await context.params;
  if (!TOKEN_PATTERN.test(token)) return expired();

  let apiRes: Response;
  try {
    apiRes = await fetch(`${internalApiV1Base()}/auth/line/handoff/exchange`, {
      method: 'POST',
      // RV22: the API keys its exchange limiter (20/60 s) on `trustedClientIp`; without the visitor's
      // chain every tap in the country shares the web container's one bucket and overflows to /login.
      headers: { 'Content-Type': 'application/json', ...forwardedClientHeaders(request.headers) },
      body: JSON.stringify({ token }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return unavailable();
  }

  const data = (await apiRes.json().catch(() => ({}))) as HandoffExchangeResult & HandoffRefusal;
  if (apiRes.status === 403) {
    // A refusal for a KNOWN token names where the user was going, so the login form can finish the
    // journey instead of dropping it (spec §15 acceptance 3). An unknown token names nothing.
    return expired(typeof data?.targetPath === 'string' ? data.targetPath : undefined);
  }
  // Only 403 confirms a token refusal. Rate limits, outages and invalid responses say nothing
  // about expiry or the browser's session, and must not send the user into LINE Login.
  if (!apiRes.ok || typeof data?.accessToken !== 'string' || !data.accessToken
    || typeof data?.refreshToken !== 'string' || !data.refreshToken) return unavailable();

  // The destination is the API's, from the token row — never anything this request supplied.
  const targetPath = sanitizeReturnTo(data.targetPath)
    ?? (data.companyId ? `/companies/${data.companyId}/dashboard` : '/');
  const res = NextResponse.redirect(new URL(targetPath, origin), 303);
  setAuthCookies(
    res,
    { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn ?? 900 },
    // `homePath` is overwritten deliberately (spec §14): it may still hold the PREVIOUS account's
    // landing, and `resolveLoginLanding` reads it — leaving it would send this user to a company
    // they cannot open the next time they pass through /login.
    { csrfToken: generateCsrfToken(), homePath: targetPath, persistent: true },
  );
  return res;
}
