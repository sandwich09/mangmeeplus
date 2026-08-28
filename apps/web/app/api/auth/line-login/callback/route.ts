import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { generateCsrfToken, setAuthCookies } from '@/common/auth/auth-cookies.server';
import {
  decodeLineLoginTxn,
  LINE_LOGIN_TXN_COOKIE,
  LINE_LOGIN_TXN_COOKIE_PATH,
  publicOriginFromHeaders,
  sanitizeReturnTo,
} from '@/features/auth/line-login-bff.logic';

type LineLoginCallbackResult = {
  linked?: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
};

// BFF completion of LINE web login: the one-time code is spent server-side by the API (which
// holds the channel secret), and the browser only ever receives the same httpOnly session
// cookies password login sets. The transaction cookie is cleared on every exit path.
export async function GET(request: NextRequest) {
  const origin = publicOriginFromHeaders(request.headers, request.nextUrl.origin);

  const clearTxn = (res: NextResponse) => {
    res.cookies.set(LINE_LOGIN_TXN_COOKIE, '', { path: LINE_LOGIN_TXN_COOKIE_PATH, maxAge: 0 });
    return res;
  };
  const redirectToLogin = (reason: string) => clearTxn(NextResponse.redirect(new URL(`/login?line=${reason}`, origin)));

  const params = request.nextUrl.searchParams;
  const txn = decodeLineLoginTxn(request.cookies.get(LINE_LOGIN_TXN_COOKIE)?.value);
  if (params.get('error')) return redirectToLogin('canceled');

  const code = params.get('code');
  const state = params.get('state');
  // No transaction, no code, or a state that does not match the one this browser started with:
  // the callback did not come from a login this session began.
  if (!txn || !code || !state || state !== txn.state) return redirectToLogin('failed');

  let apiRes: Response;
  try {
    apiRes = await fetch(`${internalApiV1Base()}/auth/line/login/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier: txn.verifier, nonce: txn.nonce }),
      cache: 'no-store',
    });
  } catch {
    return redirectToLogin('failed');
  }

  const data = (await apiRes.json().catch(() => ({}))) as LineLoginCallbackResult;
  // A verified LINE account with no linked user is not a failure: it is a different next step.
  if (apiRes.ok && data.linked === false) return redirectToLogin('link-required');
  if (!apiRes.ok || !data.accessToken || !data.refreshToken) return redirectToLogin('failed');

  // '/' is correct: the root and the /login session gate route an authenticated session on to
  // company selection, legal acceptance or the dashboard.
  const homePath = sanitizeReturnTo(txn.returnTo) ?? '/';
  const res = NextResponse.redirect(new URL(homePath, origin));
  setAuthCookies(
    res,
    { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn ?? 900 },
    { csrfToken: generateCsrfToken(), homePath, persistent: true },
  );
  return clearTxn(res);
}
