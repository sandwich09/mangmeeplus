import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { ACCESS_TOKEN_COOKIE, joinCookieChunks } from '@/common/auth/auth-cookies.constants';

// BFF approve for desktop QR login (P12-3a): the phone is already signed in, so this forwards that
// session's bearer token to the authenticated API endpoint. The desktop secret is not involved —
// approving only binds this user to the transaction; the desktop still redeems it itself.
export async function POST(request: NextRequest) {
  const accessToken = joinCookieChunks((name) => request.cookies.get(name)?.value, ACCESS_TOKEN_COOKIE);
  if (!accessToken) return NextResponse.json({ approved: false }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { code?: unknown };
  const publicCode = typeof body.code === 'string' ? body.code : '';
  if (!publicCode) return NextResponse.json({ approved: false }, { status: 400 });

  let apiRes: Response;
  try {
    apiRes = await fetch(`${internalApiV1Base()}/auth/line/qr/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ publicCode }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ approved: false }, { status: 502 });
  }

  if (!apiRes.ok) return NextResponse.json({ approved: false }, { status: apiRes.status });
  return NextResponse.json({ approved: true });
}
