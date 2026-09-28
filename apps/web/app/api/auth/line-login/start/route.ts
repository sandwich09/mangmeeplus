import { ACCESS_TOKEN_COOKIE, joinCookieChunks } from '@/common/auth/auth-cookies.constants';
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

  const state = randomUrlToken();
  const emailReauth = request.nextUrl.searchParams.get('purpose') === 'email-reauth';
  const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get('returnTo'));
  // purchase-without-setup R-B5 (4): how often a LINE link met the login wall. `from`/`auto` come
  // from LoginPage's auto-start; a manual tap on the LINE button carries only the returnTo signal.
  if (!emailReauth && returnTo && /[?&]channel=line(?:&|$)/.test(returnTo)) {
    const from = request.nextUrl.searchParams.get('from');
    console.info(JSON.stringify({ event: 'login_wall_from_line_link', from: from === 'handoff-expired' || from === 'channel-line' ? from : null,
      auto: request.nextUrl.searchParams.get('auto') === '1',
      hasSession: Boolean(joinCookieChunks((name) => request.cookies.get(name)?.value, ACCESS_TOKEN_COOKIE)) }));
  }
  let nonce = randomUrlToken(), channelId: string;
  if (emailReauth) {
    // Account security is always available for an already-linked account. It does not
    // enable the separate public LINE login feature or create/link an identity.
    const accessToken = joinCookieChunks(name => request.cookies.get(name)?.value, ACCESS_TOKEN_COOKIE);
    // R-B4: the LINE-in-app-browser reopen sends the OUTSIDE browser here with `channel=line` in
    // `returnTo`. If it has no session (first time, or cookies cleared), send it through the
    // ordinary sign-in wall with `next` set — R-B5 then starts LINE login for it automatically —
    // instead of an empty `/login` that strands `returnTo` and dead-ends the reopen.
    if (!accessToken) return NextResponse.redirect(new URL(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login', origin));
    const result = await fetch(`${internalApiV1Base()}/auth/account/email/otp/line-reauth/start`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const data = result?.ok ? await result.json().catch(() => null) : null;
    if (!data?.nonce || !data?.channelId) {
      const failed = new URL(returnTo ?? '/', origin); failed.searchParams.set('line', 'email-reauth-failed');
      return NextResponse.redirect(failed);
    }
    nonce = data.nonce; channelId = data.channelId;
  } else {
    const channels = await fetch(`${internalApiV1Base()}/auth/login-channels`, { cache: 'no-store' })
      .then((res) => res.json() as Promise<LoginChannels>).catch(() => null);
    if (!channels?.line?.available || !channels.line.channelId) return NextResponse.redirect(new URL('/login?line=unavailable', origin));
    channelId = channels.line.channelId;
  }
  const verifier = randomUrlToken();

  const res = NextResponse.redirect(
    buildLineAuthorizeUrl({
      channelId, emailReauth,
      redirectUri: `${origin}/api/auth/line-login/callback`,
      state,
      nonce,
      codeChallenge: pkceChallengeS256(verifier),
    }),
    302,
  );
  res.cookies.set(
    LINE_LOGIN_TXN_COOKIE,
    encodeLineLoginTxn({ state, nonce, verifier, ...(emailReauth ? { purpose: 'email-reauth' as const } : {}), ...(returnTo ? { returnTo } : {}) }),
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
