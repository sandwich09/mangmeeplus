import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { ACCESS_TOKEN_COOKIE, joinCookieChunks } from '@/common/auth/auth-cookies.constants';
import { clearAuthCookies } from '@/common/auth/auth-cookies.server';

// BFF logout: revokes the server session, then clears all auth cookies.
// Cookie clearing must succeed even when the API revoke call fails.
export async function POST(request: NextRequest) {
  const accessToken = joinCookieChunks((name) => request.cookies.get(name)?.value, ACCESS_TOKEN_COOKIE);
  if (accessToken) {
    await fetch(`${internalApiV1Base()}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }).catch(() => undefined);
  }

  const res = new NextResponse(null, { status: 204 });
  clearAuthCookies(res);
  return res;
}
