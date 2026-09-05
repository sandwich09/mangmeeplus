import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { forwardedClientHeaders } from '@/common/api/forwarded-client-headers';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { generateCsrfToken, resolveHomePath, setAuthCookies } from '@/common/auth/auth-cookies.server';

type ClaimResult = {
  companyId?: string;
  companyName?: string;
  homePath?: string;
  attachedToExistingUser?: boolean;
  code?: string;
  message?: string;
};

type ApiAuthSession = {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  legalAcceptanceRequired?: boolean;
  companyId?: string | null;
  redirectPath?: string;
};

// BFF for the signup claim page. The claim itself proves mailbox ownership and provisions the
// company; the follow-up password login (server-side, with the credentials this same request just
// set or verified) is what turns that into a session, so the welcome page's LINE button works in
// one click. Tokens never reach browser JS — same posture as /api/auth/login.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    mode?: unknown;
    token?: unknown;
    username?: unknown;
    identifier?: unknown;
    password?: unknown;
  };
  const mode = body.mode === 'attach' ? 'attach' : 'set-password';
  const token = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password.trim() : '';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
  if (!token || !password || (mode === 'set-password' ? !username : !identifier)) {
    return NextResponse.json({ message: 'Missing claim fields.' }, { status: 400 });
  }

  const claimPath = mode === 'attach' ? '/public/signup-claims/attach' : '/public/signup-claims/set-password';
  const claimBody = mode === 'attach' ? { token, identifier, password } : { token, username, password };
  // Review R06: this BFF reaches the API over loopback, so without the visitor's chain every
  // applicant shares ONE 20/hour claim bucket and ONE password-login failure bucket. The API trusts
  // `x-forwarded-for` only from the private tier and walks it from the right past the hops our own
  // gateway and Cloudflare appended, so forwarding it verbatim hands over the visitor and nothing
  // a visitor could choose for themselves.
  const clientHeaders = forwardedClientHeaders(request.headers);

  let claimRes: Response;
  try {
    claimRes = await fetch(`${internalApiV1Base()}${claimPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...clientHeaders },
      body: JSON.stringify(claimBody),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ message: 'Cannot reach the service.' }, { status: 502 });
  }
  const claim = (await claimRes.json().catch(() => ({}))) as ClaimResult;
  if (!claimRes.ok) {
    return NextResponse.json(claim, { status: claimRes.status });
  }

  // The claim succeeded and the company exists; a login failure past this point must not read as a
  // failed signup. sessionEstablished=false lets the page fall back to the login screen instead.
  const loginIdentifier = mode === 'attach' ? identifier : username;
  let session: ApiAuthSession = {};
  let sessionEstablished = false;
  try {
    const loginRes = await fetch(`${internalApiV1Base()}/auth/password/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...clientHeaders },
      body: JSON.stringify({ username: loginIdentifier, password }),
      cache: 'no-store',
    });
    session = (await loginRes.json().catch(() => ({}))) as ApiAuthSession;
    sessionEstablished = loginRes.ok && Boolean(session.accessToken && session.refreshToken);
  } catch {
    sessionEstablished = false;
  }

  const homePath = resolveHomePath(claim.homePath ?? session.redirectPath, claim.companyId ?? session.companyId ?? null);
  const res = NextResponse.json({
    companyId: claim.companyId,
    companyName: claim.companyName,
    homePath,
    attachedToExistingUser: claim.attachedToExistingUser ?? false,
    sessionEstablished,
    legalAcceptanceRequired: session.legalAcceptanceRequired ?? true,
  });
  if (sessionEstablished && session.accessToken && session.refreshToken) {
    setAuthCookies(
      res,
      { accessToken: session.accessToken, refreshToken: session.refreshToken, expiresIn: session.expiresIn ?? 900 },
      { csrfToken: generateCsrfToken(), homePath, persistent: true },
    );
  }
  return res;
}
