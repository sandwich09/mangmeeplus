// P12-3b LINE → web deep-link session handoff: pure token and path rules.
// Spec: docs/specs/line-web-deeplink-handoff-spec.md §9, §11.
import { generateLineLinkToken, hashLineLinkToken } from '../../../employee-access/domain/logic/employee-access.logic';

/**
 * Owner decision 2026-08-29 (spec §17 Q3): 15 minutes for assistant replies, matching
 * `LINE_LINK_TOKEN_TTL_MS`. A longer window is only useful for the alert rail — an alert pushed at
 * night and tapped in the morning — and that TTL is decided at Phase 5 with the rail itself. A
 * token is a bearer credential sitting in a chat log, so the window is the blast radius.
 */
export const LINE_HANDOFF_TOKEN_TTL_MS = 15 * 60_000;

/** The web entry route. Deliberately outside `/companies/`, so the middleware's cookie-less bounce
 *  does not intercept a request whose whole point is that it carries no session yet. */
export const HANDOFF_PATH_PREFIX = '/l/';

/** Longest destination we will store or accept, matching `sanitizeReturnTo` in the web BFF. */
const MAX_TARGET_PATH_LENGTH = 512;

/** 24 random bytes base64url + its sha256, exactly as `EmployeeLineLinkToken` mints (spec E12). */
export function generateLineHandoffToken(ttlMs: number = LINE_HANDOFF_TOKEN_TTL_MS): {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
} {
  return generateLineLinkToken(ttlMs);
}

export function hashLineHandoffToken(rawToken: string): string {
  return hashLineLinkToken(rawToken);
}

/**
 * The destination a token may be minted for, checked with `safeTenantLink`'s strictness
 * (`line-business-card.logic.ts`): same-app absolute path, inside this company's tenant root, no
 * traversal, no protocol-relative escape, no control characters, bounded length.
 *
 * This runs at MINT time. The exchange never re-reads a path from the request — it returns the one
 * stored on the row — so a token minted for company A cannot be re-pointed at company B by editing
 * the URL.
 */
export function isSafeHandoffPath(targetPath: string, companyId: string): boolean {
  if (typeof targetPath !== 'string' || targetPath.length === 0 || targetPath.length > MAX_TARGET_PATH_LENGTH) return false;
  // Browsers treat backslashes as separators and strip TAB/LF/CR before parsing, so `/\t/evil.example`
  // can become an off-origin protocol-relative URL after the check but before the fetch.
  if (!targetPath.startsWith('/') || targetPath.startsWith('//') || /[\u0000-\u001F\u007F\\]/.test(targetPath)) return false;
  if (/%2f|%5c/i.test(targetPath)) return false;
  try {
    const base = 'https://relative.invalid';
    const parsed = new URL(targetPath, base);
    if (parsed.origin !== base) return false;
    // `new URL` has already resolved `..`; comparing the RESOLVED pathname to the tenant root is
    // what makes traversal ineffective rather than merely spelled differently.
    const tenantRoot = `/companies/${encodeURIComponent(companyId)}`;
    return parsed.pathname === tenantRoot || parsed.pathname.startsWith(`${tenantRoot}/`);
  } catch {
    return false;
  }
}

/** `<web>/l/<token>` — the URL that replaces a plain deep link in an outgoing LINE message. */
export function lineHandoffUrl(webBaseUrl: string, rawToken: string): string {
  return `${webBaseUrl.replace(/\/+$/, '')}${HANDOFF_PATH_PREFIX}${rawToken}`;
}
