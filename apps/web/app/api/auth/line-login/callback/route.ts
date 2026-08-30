import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { ACCESS_TOKEN_COOKIE, joinCookieChunks } from '@/common/auth/auth-cookies.constants';
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

  // Two lanes end here. With an active session this is the link-after-password round trip (P12-2):
  // the user just signed in with a password, so the code is spent by an authenticated API call that
  // links the nonce-verified LINE identity to that user, and the session cookies stay untouched.
  // Without a session it is a plain LINE login and the public exchange below issues the tokens.
  const accessToken = joinCookieChunks((name) => request.cookies.get(name)?.value, ACCESS_TOKEN_COOKIE);
  if (accessToken) {
    // This lane always starts from a page the user is already signed in to, so its failure belongs
    // back on that page: /login redirects an authenticated session straight past the notice, which
    // is why a failed link used to end in silence. A 409 is the "this LINE belongs to another
    // account" case, kept distinct so the page can offer the merge choice (spec §4F).
    const backToStart = (reason: string) => {
      const target = sanitizeReturnTo(txn.returnTo);
      if (!target) return redirectToLogin(reason);
      const url = new URL(target, origin);
      url.searchParams.set('line', reason);
      return clearTxn(NextResponse.redirect(url));
    };

    let linkRes: Response;
    try {
      linkRes = await fetch(`${internalApiV1Base()}/auth/line/link/oauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ code, codeVerifier: txn.verifier, nonce: txn.nonce }),
        cache: 'no-store',
      });
    } catch {
      return backToStart('link-failed');
    }
    // No fall-through to the public exchange: the authorization code is single-use and already
    // spent, so a retry there can only fail again — with a less accurate reason for the user.
    if (!linkRes.ok) return backToStart(linkRes.status === 409 ? 'link-conflict' : 'link-failed');
    return clearTxn(NextResponse.redirect(new URL(sanitizeReturnTo(txn.returnTo) ?? '/', origin)));
  }

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
