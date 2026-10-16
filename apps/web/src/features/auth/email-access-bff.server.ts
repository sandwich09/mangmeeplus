import { sanitizeNextPath } from '@/common/auth/middleware.logic';
import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { forwardedClientHeaders } from '@/common/api/forwarded-client-headers';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { generateCsrfToken, resolveHomePath, setAuthCookies } from '@/common/auth/auth-cookies.server';

const COOKIE = 'mm_email_access';
export async function emailAccessBff(request: NextRequest, action: string) {
  if (!['request', 'confirm', 'signup', 'status'].includes(action)) return NextResponse.json({}, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ message: 'ตรวจข้อมูลที่กรอกอีกครั้ง' }, { status: 400 });
  let proof: { browserSecret?: string; challengeId?: string; nextPath?: string } = {};
  try { const value = JSON.parse(request.cookies.get(COOKIE)?.value ?? '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) proof = value; } catch { /* Invalid cookie cannot authorize. */ }
  const browserSecret = /^[A-Za-z0-9_-]{43}$/.test(proof.browserSecret ?? '') ? proof.browserSecret! : randomBytes(32).toString('base64url');
  if (action !== 'request' && (!proof.challengeId || browserSecret !== proof.browserSecret)) {
    return NextResponse.json({ message: 'ขอรหัสทางอีเมลอีกครั้ง', code: 'EMAIL_ACCESS_INVALID' }, { status: 401 });
  }
  const payload = action === 'request' ? { email: body.email, requestKey: body.requestKey, browserSecret }
    : { challengeId: proof.challengeId, browserSecret,
      ...(action === 'confirm' ? { code: body.code } : {}),
      ...(action === 'signup' ? { companyName: body.companyName, displayName: body.displayName, phoneNumber: body.phoneNumber, consentVersion: body.consentVersion } : {}) };
  let upstream: Response;
  try {
    upstream = await fetch(`${internalApiV1Base()}/public/email-access/${action}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...forwardedClientHeaders(request.headers) }, body: JSON.stringify(payload), cache: 'no-store' });
  } catch {
    return NextResponse.json({ message: 'เชื่อมต่อไม่ได้ ลองอีกครั้ง' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  const data = await upstream.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return NextResponse.json({ message: 'ยังทำไม่ได้ ลองอีกครั้ง' }, { status: 502 });
  // Explicit response allowlist: API tokens and browser proof never reach JavaScript.
  const safe = Object.fromEntries(['companyId', 'email', 'kind', 'state', 'requestId', 'challengeId', 'expiresAt', 'retryAt', 'deliveryStatus', 'retryAfterSeconds', 'code', 'message']
    .filter(key => ['string', 'number'].includes(typeof data[key])).map(key => [key, data[key]]));
  if (Array.isArray(data.message)) safe.message = 'ตรวจข้อมูลที่กรอกอีกครั้ง';
  const login = upstream.ok && data.kind === 'LOGIN';
  if (login && (!data.accessToken || !data.refreshToken)) return NextResponse.json({ message: 'ยังเข้าสู่ระบบไม่สำเร็จ ขอรหัสใหม่' }, { status: 502 });
  const homePath = login ? resolveHomePath(data.redirectPath, data.companyId) : null;
  const nextPath = typeof proof.nextPath === 'string' ? sanitizeNextPath(proof.nextPath) : null;
  const response = NextResponse.json({ ...safe, ...(login ? { redirectPath: nextPath ?? homePath, legalAcceptanceRequired: data.legalAcceptanceRequired ?? true, passwordChangeRequired: data.passwordChangeRequired ?? false } : {}) },
    { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
  if (action === 'request' && upstream.ok && typeof data.challengeId === 'string') {
    response.cookies.set(COOKIE, JSON.stringify({ browserSecret, challengeId: data.challengeId, nextPath: typeof body.nextPath === 'string' ? sanitizeNextPath(body.nextPath) : null }), {
      httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', path: '/api/auth/email-access', maxAge: 20 * 60,
    });
  }
  if (login && homePath) {
    setAuthCookies(response, { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn ?? 900 },
      { csrfToken: generateCsrfToken(), homePath, persistent: true });
    response.cookies.set(COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/api/auth/email-access', maxAge: 0 });
  }
  return response;
}
