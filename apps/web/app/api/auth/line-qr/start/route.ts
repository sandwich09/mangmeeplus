import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import {
  LINE_QR_SECRET_COOKIE,
  LINE_QR_SECRET_COOKIE_MAX_AGE,
  LINE_QR_SECRET_COOKIE_PATH,
  sanitizeReturnTo,
} from '@/features/auth/line-login-bff.logic';

type LineQrCreateResult = {
  desktopSecret?: string;
  qrImageUrl?: string;
  scanUrl?: string;
  expiresInSeconds?: number;
};

// BFF start of desktop QR login (P12-3a). The API mints both halves of the transaction; the
// desktop secret is kept here in an HttpOnly cookie and never handed to the page script, so the
// only thing the browser can do with the QR is display it.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { returnTo?: unknown };
  const returnTo = sanitizeReturnTo(typeof body.returnTo === 'string' ? body.returnTo : null);

  let apiRes: Response;
  try {
    apiRes = await fetch(`${internalApiV1Base()}/auth/line/qr/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(returnTo ? { returnTo } : {}),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: true }, { status: 502 });
  }

  const data = (await apiRes.json().catch(() => ({}))) as LineQrCreateResult;
  if (!apiRes.ok || !data.desktopSecret || !data.qrImageUrl || !data.scanUrl) {
    return NextResponse.json({ error: true }, { status: 502 });
  }

  const res = NextResponse.json({
    qrImageUrl: data.qrImageUrl,
    scanUrl: data.scanUrl,
    expiresInSeconds: data.expiresInSeconds ?? 180,
  });
  res.cookies.set(LINE_QR_SECRET_COOKIE, data.desktopSecret, {
    httpOnly: true,
    sameSite: 'lax',
    // Same rule as the auth cookies: the local Docker stack is a production build served over
    // plain http, where a Secure cookie is dropped. See auth-cookies.server.ts.
    secure: process.env.NODE_ENV === 'production' && process.env['APP_ENV'] !== 'local',
    path: LINE_QR_SECRET_COOKIE_PATH,
    maxAge: LINE_QR_SECRET_COOKIE_MAX_AGE,
  });
  return res;
}
