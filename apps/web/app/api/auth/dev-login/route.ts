import { NextResponse } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { generateCsrfToken, resolveHomePath, setAuthCookies } from '@/common/auth/auth-cookies.server';

type ApiTokens = { accessToken?: string; refreshToken?: string; expiresIn?: number };

// Local-development sign-in: exchanges the API's dev token (seeded OWNER) for a real
// cookie session. Replaces the old fabricated local-owner session with real auth.
// Double-gated: hidden here outside dev builds, and the API endpoint 404s unless APP_ENV=local.
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }

  let apiRes: Response;
  try {
    apiRes = await fetch(`${internalApiV1Base()}/auth/dev/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ message: 'Cannot reach the authentication service.' }, { status: 502 });
  }

  const data = (await apiRes.json().catch(() => ({}))) as ApiTokens & { message?: string };
  if (!apiRes.ok || !data.accessToken || !data.refreshToken) {
    const status = apiRes.ok ? 502 : apiRes.status;
    return NextResponse.json({ message: data.message ?? 'Dev sign-in is unavailable.' }, { status });
  }

  // Resolve the seeded owner's company for the landing path.
  let companyId: string | null = null;
  let legalAcceptanceRequired = true;
  try {
    const meRes = await fetch(`${internalApiV1Base()}/auth/me`, {
      headers: { Authorization: `Bearer ${data.accessToken}` },
      cache: 'no-store',
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as {
        companyId?: string | null;
        legalAcceptanceRequired?: boolean;
      };
      companyId = me.companyId ?? null;
      legalAcceptanceRequired = me.legalAcceptanceRequired ?? true;
    }
  } catch {
    // fall through: land on '/' when the company cannot be resolved
  }

  const homePath = resolveHomePath(null, companyId);
  const res = NextResponse.json({
    passwordChangeRequired: false,
    legalAcceptanceRequired,
    companyId,
    redirectPath: homePath,
  });
  setAuthCookies(
    res,
    { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn ?? 900 },
    { csrfToken: generateCsrfToken(), homePath },
  );
  return res;
}
