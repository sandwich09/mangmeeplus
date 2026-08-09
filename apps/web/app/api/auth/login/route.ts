import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { generateCsrfToken, resolveHomePath, setAuthCookies } from '@/common/auth/auth-cookies.server';

type ApiAuthSession = {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  passwordChangeRequired?: boolean;
  legalAcceptanceRequired?: boolean;
  companyId?: string | null;
  redirectPath?: string;
  code?: string;
  message?: string;
};

// BFF login: exchanges credentials server-side and stores tokens in httpOnly cookies.
// Tokens are never returned to the browser JS.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { username?: unknown; password?: unknown; remember?: unknown };
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  // Product rule: trim every input, passwords included (the API trims on set and verify too).
  const password = typeof body.password === 'string' ? body.password.trim() : '';
  const remember = body.remember !== false;
  if (!username || !password) {
    return NextResponse.json({ message: 'Username and password are required.' }, { status: 400 });
  }

  let apiRes: Response;
  try {
    apiRes = await fetch(`${internalApiV1Base()}/auth/password/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ message: 'Cannot reach the authentication service.' }, { status: 502 });
  }

  const data = (await apiRes.json().catch(() => ({}))) as ApiAuthSession;
  if (!apiRes.ok || !data.accessToken || !data.refreshToken) {
    const status = apiRes.ok ? 502 : apiRes.status;
    return NextResponse.json({
      message: data.message ?? 'Invalid username or password.',
      ...(data.code ? { code: data.code } : {}),
    }, { status });
  }

  const homePath = resolveHomePath(data.redirectPath, data.companyId);
  const res = NextResponse.json({
    passwordChangeRequired: data.passwordChangeRequired ?? false,
    // Mixed-version rollout must fail closed: an older API that omits the field has not proved
    // that this membership accepted the current legal release.
    legalAcceptanceRequired: data.legalAcceptanceRequired ?? true,
    companyId: data.companyId ?? null,
    redirectPath: homePath,
  });
  setAuthCookies(
    res,
    { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn ?? 900 },
    { csrfToken: generateCsrfToken(), homePath, persistent: remember },
  );
  return res;
}
