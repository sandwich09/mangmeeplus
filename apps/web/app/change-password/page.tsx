import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import ChangePasswordPage from '@/features/auth/ChangePasswordPage';
import { HOME_PATH_COOKIE } from '@/common/auth/auth-cookies.constants';
import { fetchServerSessionResult } from '@/common/auth/server-session';
import { resolveLoginLanding } from '@/common/auth/session-gate.logic';

export const dynamic = 'force-dynamic';

// Only a session that is *not* blocked can actually navigate away from here: the API 403s a
// temporary-password session out of every business route and the client bounces it straight back,
// which is what made this page a dead end. So the back/home exits are handed to the page only when
// the server says the session is free to leave — `=== false`, so a session whose flag is missing
// (an API older than this build) keeps the sign-out-only page instead of a button that loops.
export default async function ChangePasswordRoute() {
  const result = await fetchServerSessionResult();
  if (result.status === 'platform_closed') redirect('/maintenance');
  const session = result.status === 'signed_in' && result.session.mustChangePassword === false
    ? result.session
    : null;
  const homeCookie = session ? (await cookies()).get(HOME_PATH_COOKIE)?.value : undefined;

  return <ChangePasswordPage homePath={session ? resolveLoginLanding(null, homeCookie, session) : null} />;
}
