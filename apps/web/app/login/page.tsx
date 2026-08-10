import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LoginPage from '@/features/auth/LoginPage';
import { HOME_PATH_COOKIE } from '@/common/auth/auth-cookies.constants';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import { resolveLoginLanding } from '@/common/auth/session-gate.logic';
import { internalApiV1Base } from '@/common/api/internal-api-base';

export const dynamic = 'force-dynamic';

async function platformAccessState(): Promise<'OPEN' | 'CLOSED'> {
  try {
    const response = await fetch(`${internalApiV1Base()}/auth/platform-access`, { cache: 'no-store' });
    if (!response.ok) return 'CLOSED';
    const body = (await response.json()) as { state?: unknown };
    return body.state === 'OPEN' ? 'OPEN' : 'CLOSED';
  } catch {
    return 'CLOSED';
  }
}

// Only a real GET /auth/me pass redirects away from /login. Every other outcome — no cookie,
// expired/revoked/malformed cookie, forbidden, auth service unavailable — renders the form, which
// first attempts the refresh-cookie recovery (the refresh cookie is path-scoped to /api/auth and
// invisible to this request). Redirecting on cookie presence alone is what caused the redirect loop.
export default async function LoginRoute({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; home?: string | string[] }>;
}) {
  const [{ next, home }, result, accessState] = await Promise.all([
    searchParams,
    fetchServerSessionResult(),
    platformAccessState(),
  ]);

  if (result.status === 'signed_in') {
    // Audit H-16: "go to an available company" sent the user here, and the remembered home pointed
    // straight back at the company they could not open — the redirect looped and only signing out
    // escaped it. That screen asks for the remembered landing to be ignored, so the session's own
    // company is used instead. Not cleared, only skipped: cookies are read-only during render, and
    // the next successful landing rewrites it anyway.
    const homeCookie = home === 'reset' ? undefined : (await cookies()).get(HOME_PATH_COOKIE)?.value;
    const landing = resolveLoginLanding(typeof next === 'string' ? next : null, homeCookie, result.session);
    if (landing) redirect(landing);
  }

  return (
    <div className="contents" data-platform-access={accessState.toLowerCase()}>
      {accessState === 'CLOSED' ? (
        <span className="sr-only">ระบบกำลังปรับปรุง</span>
      ) : null}
      <LoginPage accessState={accessState} />
    </div>
  );
}
