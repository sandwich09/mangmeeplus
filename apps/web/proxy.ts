import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { ACCESS_TOKEN_COOKIE, CSRF_COOKIE, CSRF_ERROR_CODE, CSRF_HEADER, REQUEST_PATH_HEADER } from '@/common/auth/auth-cookies.constants';
import {
  isCsrfTokenValid,
  isProtectedPagePath,
  isSameOriginRequest,
  requiresCsrfCheck,
} from '@/common/auth/middleware.logic';
import {
  BASE_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  buildS3EndpointOrigin,
  buildS3UploadOrigin,
  usesDevelopmentCsp,
} from '@/common/security/security-headers.logic';
import { shouldShowCompatibilityNotice } from '@/common/client-support/client-support.logic';

function secureResponse(response: NextResponse, csp: string): NextResponse {
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}

function compatibilityResponse(response: NextResponse, csp: string): NextResponse {
  secureResponse(response, csp);
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

// Route guard + CSRF gate for the cookie session model. Middleware is a cheap presence gate only —
// a cookie is never proof of authentication, so it may bounce cookie-less visitors but must never
// decide that someone IS signed in:
// - /companies/* and /system/* with no access cookie bounce to /login?next=…; with a cookie they
//   fall through to the layout, which validates the real session against GET /auth/me.
// - /login is not gated here at all. Its server route validates the session and redirects only a
//   genuinely authenticated visitor; an expired/revoked/malformed cookie renders the form (which
//   silently recovers via the refresh cookie), instead of ping-ponging with the layout guards.
// - Mutating /api/* calls must be same-origin; cookie-authenticated /api/v1 mutations
//   additionally need the double-submit CSRF header.
export function proxy(request: NextRequest) {
  const nonce = randomBytes(16).toString('base64');
  const csp = buildContentSecurityPolicy(nonce, [
    process.env.NEXT_PUBLIC_API_BASE_URL,
    process.env.NEXT_PUBLIC_API_URL,
    process.env.NEXT_PUBLIC_AI_GATEWAY_BASE_URL,
    buildS3UploadOrigin(process.env.S3_BUCKET, process.env.S3_REGION ?? 'ap-southeast-1'),
    buildS3EndpointOrigin(process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT),
  ], usesDevelopmentCsp(process.env));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const next = () => secureResponse(NextResponse.next({ request: { headers: requestHeaders } }), csp);
  const { pathname, search } = request.nextUrl;
  // Server components cannot read the requested URL. The company layout needs it so the
  // change-password and legal-acceptance gates can return the user to the page they opened
  // (a LINE deep link) instead of the dashboard. Set from nextUrl, so a client-sent value cannot win.
  requestHeaders.set(REQUEST_PATH_HEADER, `${pathname}${search}`);
  const method = request.method;
  // Large access tokens are chunked into `<name>.0..N` (see auth-cookies.constants).
  const hasAccessCookie = Boolean(
    request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? request.cookies.get(`${ACCESS_TOKEN_COOKIE}.0`)?.value,
  );

  if (pathname.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const effectiveHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
      if (!isSameOriginRequest(request.headers.get('origin'), request.headers.get('sec-fetch-site'), effectiveHost)) {
        return secureResponse(NextResponse.json({ message: 'Cross-origin request rejected.' }, { status: 403 }), csp);
      }
      if (
        requiresCsrfCheck(method, pathname, hasAccessCookie) &&
        !isCsrfTokenValid(request.cookies.get(CSRF_COOKIE)?.value, request.headers.get(CSRF_HEADER))
      ) {
        // Fail closed, but say why: this is the one 403 the client may recover from by
        // refreshing (which reissues the CSRF cookie) and retrying the mutation once.
        return secureResponse(NextResponse.json({ message: 'CSRF token missing or invalid.', code: CSRF_ERROR_CODE }, { status: 403 }), csp);
      }
    }
    return next();
  }

  if (shouldShowCompatibilityNotice({
    pathname,
    method,
    accept: request.headers.get('accept'),
    fetchDestination: request.headers.get('sec-fetch-dest'),
    userAgent: request.headers.get('user-agent'),
  })) {
    const noticeUrl = new URL('/unsupported-browser', request.url);
    noticeUrl.searchParams.set('next', `${pathname}${search}`);
    return compatibilityResponse(NextResponse.redirect(noticeUrl), csp);
  }

  if (pathname === '/unsupported-browser' || pathname.startsWith('/unsupported-browser/')) {
    return compatibilityResponse(next(), csp);
  }

  if (isProtectedPagePath(pathname) && !hasAccessCookie) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return secureResponse(NextResponse.redirect(loginUrl), csp);
  }

  if(pathname==='/reset-password'){const response=next();response.headers.set('Referrer-Policy','no-referrer');response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Robots-Tag','noindex, nofollow');return response;}
  return next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
