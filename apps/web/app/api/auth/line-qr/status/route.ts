import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { generateCsrfToken, setAuthCookies } from '@/common/auth/auth-cookies.server';
import {
  LINE_QR_SECRET_COOKIE,
  LINE_QR_SECRET_COOKIE_PATH,
  sanitizeReturnTo,
} from '@/features/auth/line-login-bff.logic';

type LineQrRedeemResult = {
  status?: 'pending' | 'expired' | 'approved';
  returnTo?: string | null;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
};

const clearSecret = (res: NextResponse) => {
  res.cookies.set(LINE_QR_SECRET_COOKIE, '', { path: LINE_QR_SECRET_COOKIE_PATH, maxAge: 0 });
  return res;
};

// BFF poll for desktop QR login (P12-3a). The desktop secret never leaves this route, and the
// tokens the API returns are turned straight into the same httpOnly session cookies password login
// sets — the page script only ever sees a status and a path to navigate to.
export async function POST(request: NextRequest) {
  const desktopSecret = request.cookies.get(LINE_QR_SECRET_COOKIE)?.value;
  if (!desktopSecret) return NextResponse.json({ status: 'expired' });

  let apiRes: Response;
  try {
    apiRes = await fetch(`${internalApiV1Base()}/auth/line/qr/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desktopSecret }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ status: 'error' }, { status: 502 });
  }

  const data = (await apiRes.json().catch(() => ({}))) as LineQrRedeemResult;
  // A rejected or unknown secret is dead for this browser: drop it rather than poll on with it.
  if (!apiRes.ok) return clearSecret(NextResponse.json({ status: 'expired' }));
  if (data.status === 'pending') return NextResponse.json({ status: 'pending' });
  if (data.status !== 'approved' || !data.accessToken || !data.refreshToken) {
    return clearSecret(NextResponse.json({ status: 'expired' }));
  }

  // '/' is correct: the root and the /login session gate route an authenticated session on to
  // company selection, legal acceptance or the dashboard.
  const redirectPath = sanitizeReturnTo(data.returnTo) ?? '/';
  const res = NextResponse.json({ status: 'approved', redirectPath });
  setAuthCookies(
    res,
    { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn ?? 900 },
    { csrfToken: generateCsrfToken(), homePath: redirectPath, persistent: true },
  );
  return clearSecret(res);
}
