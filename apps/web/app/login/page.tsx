import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LoginPage from '@/features/auth/LoginPage';
import { HOME_PATH_COOKIE } from '@/common/auth/auth-cookies.constants';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import { resolveLoginLanding } from '@/common/auth/session-gate.logic';

export const dynamic = 'force-dynamic';

// Only a real GET /auth/me pass redirects away from /login. Every other outcome — no cookie,
// expired/revoked/malformed cookie, forbidden, auth service unavailable — renders the form, which
// first attempts the refresh-cookie recovery (the refresh cookie is path-scoped to /api/auth and
// invisible to this request). Redirecting on cookie presence alone is what caused the redirect loop.
export default async function LoginRoute({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; home?: string | string[] }>;
}) {
  const [{ next, home }, result] = await Promise.all([searchParams, fetchServerSessionResult()]);

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

  return <LoginPage />;
}
