import { NextResponse } from 'next/server';
import { clearAuthCookies } from '@/common/auth/auth-cookies.server';

export function loginFailureResponse(
  data: { message?: string; code?: string },
  status: number,
): NextResponse {
  const response = NextResponse.json({
    message: data.message ?? 'Invalid username or password.',
    ...(data.code ? { code: data.code } : {}),
  }, { status });
  if (data.code === 'platform_access_closed') clearAuthCookies(response);
  return response;
}
