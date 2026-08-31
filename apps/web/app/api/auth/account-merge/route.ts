import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { ACCESS_TOKEN_COOKIE, joinCookieChunks } from '@/common/auth/auth-cookies.constants';
import { generateCsrfToken, httpOnlyFlags, setAuthCookies } from '@/common/auth/auth-cookies.server';
import { ACCOUNT_MERGE_COOKIE, ACCOUNT_MERGE_COOKIE_PATH, decodeAccountMergeCookie } from '@/features/auth/account-merge-bff.logic';

type MergeResult = { merged?: boolean; accessToken?: string; refreshToken?: string; expiresIn?: number; code?: string };

// BFF for spec §4F "รวมเข้าบัญชีเดิม". Two credentials meet here and neither reaches browser JS:
// the merge ticket from its HttpOnly cookie and the current session's access token. The API answers
// with a session for the *existing* account, so this route swaps the auth cookies the same way the
// LINE login callback does — the page then does a full navigation, because the cookies changed.
export async function POST(request: NextRequest) {
  const merge = decodeAccountMergeCookie(request.cookies.get(ACCOUNT_MERGE_COOKIE)?.value);
  const accessToken = joinCookieChunks((name) => request.cookies.get(name)?.value, ACCESS_TOKEN_COOKIE);
  if (!merge) return NextResponse.json({ code: 'merge_ticket_missing' }, { status: 400 });
  if (!accessToken) return NextResponse.json({ code: 'session_expired' }, { status: 401 });

  let apiRes: Response;
  try {
    apiRes = await fetch(`${internalApiV1Base()}/auth/account-merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ ticket: merge.ticket }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ code: 'service_unreachable' }, { status: 502 });
  }

  const data = (await apiRes.json().catch(() => ({}))) as MergeResult;
  if (!apiRes.ok || !data.accessToken || !data.refreshToken) {
    // The ticket's own code is passed through so the dialog can say something true in Thai; the
    // cookie is left alone so a transient failure can still be retried until it expires.
    return NextResponse.json({ code: data.code ?? 'merge_failed' }, { status: apiRes.ok ? 502 : apiRes.status });
  }

  const res = NextResponse.json({ merged: true });
  res.cookies.set(ACCOUNT_MERGE_COOKIE, '', { ...httpOnlyFlags(), path: ACCOUNT_MERGE_COOKIE_PATH, maxAge: 0 });
  // '/' is correct: the root routes an authenticated session on to company selection, legal
  // acceptance or the dashboard — the merged account may land on any of the three.
  setAuthCookies(
    res,
    { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn ?? 900 },
    { csrfToken: generateCsrfToken(), homePath: '/', persistent: true },
  );
  return res;
}
