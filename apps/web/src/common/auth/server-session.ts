// Server-component session lookup: reads the httpOnly access cookie and resolves
// the real request context via GET /v1/auth/me. This — not cookie presence — is the
// single authentication boundary for every protected server layout and for /login.
import { cookies } from 'next/headers';
import { internalApiV1Base } from '../api/internal-api-base';
import { ACCESS_TOKEN_COOKIE, joinCookieChunks } from './auth-cookies.constants';
import { mapAuthMeStatus } from './session-gate.logic';
import type { WebSession } from '../models/web-session.model';

export type ServerSessionResult =
  | { status: 'signed_in'; session: WebSession }
  | { status: 'signed_out' }
  | { status: 'forbidden' }
  | { status: 'unavailable' };

export async function fetchServerSessionResult(companyId?: string): Promise<ServerSessionResult> {
  const cookieStore = await cookies();
  const token = joinCookieChunks((name) => cookieStore.get(name)?.value, ACCESS_TOKEN_COOKIE);
  if (!token) return { status: 'signed_out' };

  let res: Response;
  try {
    res = await fetch(`${internalApiV1Base()}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(companyId ? { 'X-Company-Id': companyId } : {}),
      },
      cache: 'no-store',
    });
  } catch {
    // The auth service is unreachable — that is an outage, not a signed-out user.
    return { status: 'unavailable' };
  }

  const outcome = mapAuthMeStatus(res.status);
  if (outcome !== 'signed_in') return { status: outcome };

  try {
    return { status: 'signed_in', session: (await res.json()) as WebSession };
  } catch {
    return { status: 'unavailable' };
  }
}

export async function fetchServerSession(companyId?: string): Promise<WebSession | null> {
  const result = await fetchServerSessionResult(companyId);
  return result.status === 'signed_in' ? result.session : null;
}
