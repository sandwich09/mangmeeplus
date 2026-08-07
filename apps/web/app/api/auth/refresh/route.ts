import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { CSRF_COOKIE, PERSIST_COOKIE, REFRESH_TOKEN_COOKIE } from '@/common/auth/auth-cookies.constants';
import { clearAuthCookies, generateCsrfToken, setAuthCookies } from '@/common/auth/auth-cookies.server';

type ApiTokens = { accessToken?: string; refreshToken?: string; expiresIn?: number };

// BFF refresh: rotates the session using the path-scoped refresh cookie.
// 204 with fresh cookies on success; 401 with cleared cookies when the session is gone.
// Every other failure keeps the cookies — destroying a session is reserved for the one answer
// that says the session is actually gone.
export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) {
    const res = NextResponse.json({ message: 'No active session.' }, { status: 401 });
    clearAuthCookies(res);
    return res;
  }

  let apiRes: Response;
  try {
    apiRes = await fetch(`${internalApiV1Base()}/auth/session/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
  } catch {
    // Transient network failure: keep cookies so the client can retry.
    return NextResponse.json({ message: 'Cannot reach the authentication service.' }, { status: 502 });
  }

  const data = (await apiRes.json().catch(() => ({}))) as ApiTokens;
  // 401 is the only answer that means the session itself is gone, so it is the only one that
  // deletes the cookies.
  if (apiRes.status === 401) {
    const res = NextResponse.json({ message: 'Session is expired or revoked.' }, { status: 401 });
    clearAuthCookies(res);
    return res;
  }
  // Anything else is the API or one of its dependencies failing, not the session ending: keep the
  // cookies so the client can retry once it recovers, exactly like the network branch above. A
  // 503 from, say, a Redis failover would otherwise log out every user whose 15-minute access
  // token happened to expire during the outage, while their session rows are still ACTIVE.
  if (!apiRes.ok || !data.accessToken || !data.refreshToken) {
    return NextResponse.json(
      { message: 'Cannot reach the authentication service.' },
      { status: apiRes.ok ? 502 : apiRes.status },
    );
  }

  const res = new NextResponse(null, { status: 204 });
  // Keep the existing CSRF token stable across refreshes; issue one only if missing.
  const existingCsrf = request.cookies.get(CSRF_COOKIE)?.value;
  // Preserve the original "remember me" choice across rotations (default: persistent).
  const persistent = request.cookies.get(PERSIST_COOKIE)?.value !== '0';
  setAuthCookies(
    res,
    { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn ?? 900 },
    { csrfToken: existingCsrf ?? generateCsrfToken(), persistent },
  );
  return res;
}
