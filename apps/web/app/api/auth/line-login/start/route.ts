import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import {
  buildLineAuthorizeUrl,
  encodeLineLoginTxn,
  LINE_LOGIN_TXN_COOKIE,
  LINE_LOGIN_TXN_COOKIE_PATH,
  pkceChallengeS256,
  publicOriginFromHeaders,
  randomUrlToken,
  sanitizeReturnTo,
} from '@/features/auth/line-login-bff.logic';

type LoginChannels = { line?: { available?: boolean; channelId?: string } };

// BFF start of LINE web login (OAuth Authorization Code + PKCE). State, nonce and the PKCE
// verifier are minted here and kept in an HttpOnly cookie the browser cannot read; only the
// derived S256 challenge travels to LINE.
export async function GET(request: NextRequest) {
  const origin = publicOriginFromHeaders(request.headers, request.nextUrl.origin);

  const channels = await fetch(`${internalApiV1Base()}/auth/login-channels`, { cache: 'no-store' })
    .then((res) => res.json() as Promise<LoginChannels>)
    .catch(() => null);
  // The API owns the flag and the credentials, so an unavailable channel never reaches LINE.
  if (!channels?.line?.available || !channels.line.channelId) {
    return NextResponse.redirect(new URL('/login?line=unavailable', origin));
  }

  const state = randomUrlToken();
  const nonce = randomUrlToken();
  const verifier = randomUrlToken();
  const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get('returnTo'));

  const res = NextResponse.redirect(
    buildLineAuthorizeUrl({
      channelId: channels.line.channelId,
      redirectUri: `${origin}/api/auth/line-login/callback`,
      state,
      nonce,
      codeChallenge: pkceChallengeS256(verifier),
    }),
    302,
  );
  res.cookies.set(
    LINE_LOGIN_TXN_COOKIE,
    encodeLineLoginTxn({ state, nonce, verifier, ...(returnTo ? { returnTo } : {}) }),
    {
      httpOnly: true,
      sameSite: 'lax',
      // Same rule as the auth cookies: the local Docker stack is a production build served
      // over plain http, where a Secure cookie is dropped. See auth-cookies.server.ts.
      secure: process.env.NODE_ENV === 'production' && process.env['APP_ENV'] !== 'local',
      path: LINE_LOGIN_TXN_COOKIE_PATH,
      maxAge: 600,
    },
  );
  return res;
}
