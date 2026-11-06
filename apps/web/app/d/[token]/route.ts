import { NextResponse, type NextRequest } from 'next/server';
import { forwardedClientHeaders } from '@/common/api/forwarded-client-headers';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { generateCsrfToken, setAuthCookies } from '@/common/auth/auth-cookies.server';
import { publicOriginFromHeaders, sanitizeReturnTo } from '@/features/auth/line-login-bff.logic';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

// Link previews must never open a demo shop.
export function HEAD() {
  return new Response(null, { status: 204 });
}

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const origin = publicOriginFromHeaders(request.headers, request.nextUrl.origin);
  const recovery = (reason?: 'unavailable') => {
    const response = NextResponse.redirect(new URL(`/d/expired${reason ? '?reason=unavailable' : ''}`, origin), 303);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  };
  const { token } = await context.params;
  if (!TOKEN_PATTERN.test(token)) return recovery();

  try {
    const apiRes = await fetch(`${internalApiV1Base()}/auth/demo/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...forwardedClientHeaders(request.headers) },
      body: JSON.stringify({ token }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (apiRes.status === 410) return recovery();
    if (!apiRes.ok) return recovery('unavailable');
    const data = await apiRes.json();
    if (typeof data?.accessToken !== 'string' || !data.accessToken
      || typeof data?.refreshToken !== 'string' || !data.refreshToken) return recovery('unavailable');
    const targetPath = sanitizeReturnTo(data.targetPath)
      ?? (data.companyId ? `/companies/${encodeURIComponent(data.companyId)}/dashboard` : null);
    if (!targetPath) return recovery('unavailable');
    const response = NextResponse.redirect(new URL(targetPath, origin), 303);
    setAuthCookies(response, {
      accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn ?? 900,
    }, { csrfToken: generateCsrfToken(), homePath: targetPath, persistent: false });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch {
    return recovery('unavailable');
  }
}
