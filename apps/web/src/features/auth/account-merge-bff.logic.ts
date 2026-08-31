// Server-only helpers for the spec §4F account-merge BFF routes.
// Pure functions, no Next imports — the route handlers own request/response and cookies.

/**
 * The merge ticket is a bearer credential, so it lives in an HttpOnly cookie for the few minutes
 * between the conflicting link attempt and the user's answer — never in a URL, where it would land
 * in history, referrers and server logs. The path scopes it to the two routes that spend it.
 */
export const ACCOUNT_MERGE_COOKIE = 'watchdog_account_merge';
export const ACCOUNT_MERGE_COOKIE_PATH = '/api/auth/account-merge';
/** Matches ACCOUNT_MERGE_TICKET_TTL_MS on the API, so the cookie dies with the ticket. */
export const ACCOUNT_MERGE_COOKIE_MAX_AGE = 15 * 60;

/** Names the other account well enough to decide, and nothing more: no email, no username. */
export type ExistingAccountSummary = { displayName: string; companyNames: string[] };
export type AccountMergeCookie = { ticket: string; existingAccount: ExistingAccountSummary };

const MAX_COMPANY_NAMES = 5;
const MAX_NAME_LENGTH = 80;

function trim(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_NAME_LENGTH) : '';
}

/** Bounded on the way in: a cookie over ~4 KB is silently dropped by the browser, which would
 *  turn a long company list into "no merge offer" rather than a truncated one. */
export function encodeAccountMergeCookie(input: { ticket: string; existingAccount?: unknown }): string {
  const account = (input.existingAccount ?? {}) as { displayName?: unknown; companyNames?: unknown };
  const payload: AccountMergeCookie = {
    ticket: input.ticket,
    existingAccount: {
      displayName: trim(account.displayName),
      companyNames: (Array.isArray(account.companyNames) ? account.companyNames : [])
        .slice(0, MAX_COMPANY_NAMES)
        .map(trim)
        .filter(Boolean),
    },
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeAccountMergeCookie(raw: string | undefined): AccountMergeCookie | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as AccountMergeCookie;
    if (typeof parsed?.ticket !== 'string' || parsed.ticket.length === 0) return null;
    return {
      ticket: parsed.ticket,
      existingAccount: {
        displayName: trim(parsed.existingAccount?.displayName),
        companyNames: (Array.isArray(parsed.existingAccount?.companyNames) ? parsed.existingAccount.companyNames : [])
          .slice(0, MAX_COMPANY_NAMES)
          .map(trim)
          .filter(Boolean),
      },
    };
  } catch {
    return null;
  }
}
