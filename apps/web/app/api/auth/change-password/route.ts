import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ACCESS_TOKEN_COOKIE, joinCookieChunks } from '@/common/auth/auth-cookies.constants';
import { forwardPasswordChange } from '@/common/auth/change-password-bff.server';

export async function POST(request: NextRequest) {
  const accessToken = joinCookieChunks((name) => request.cookies.get(name)?.value, ACCESS_TOKEN_COOKIE);
  if (!accessToken) {
    return NextResponse.json({ message: 'No active session.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword.trim() : undefined;
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword.trim() : '';
  if (!newPassword) {
    return NextResponse.json({ message: 'A new password is required.' }, { status: 400 });
  }

  let apiRes: Response;
  try {
    apiRes = await forwardPasswordChange(accessToken, { newPassword, ...(currentPassword ? { currentPassword } : {}) });
  } catch {
    return NextResponse.json({ message: 'Cannot reach the authentication service.' }, { status: 502 });
  }

  if (apiRes.ok) return new NextResponse(null, { status: 204 });
  const data = (await apiRes.json().catch(() => ({}))) as { message?: unknown; code?: unknown };
  return NextResponse.json(
    {
      message: typeof data.message === 'string' ? data.message : 'Password change failed.',
      // Carried through so the client can name the specific rule that rejected the change.
      ...(typeof data.code === 'string' ? { code: data.code } : {}),
    },
    { status: apiRes.status },
  );
}
