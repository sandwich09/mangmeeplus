// P12-3b LINE → web deep-link session handoff: token and path rules, plus the revoke a severed
// LINE link owes the tokens already sent to it.
// Spec: docs/specs/line-web-deeplink-handoff-spec.md §9, §11.
import { generateLineLinkToken, hashLineLinkToken } from '../../../employee-access/domain/logic/employee-access.logic';
import { isBillingCustomerRecoveryPath } from '@watchdog-bms/contracts';

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

/**
 * The ONE `surface` whose exchange also switches the LINE chat's company context.
 *
 * Owner 2026-09-06: บริษัทของฉัน gained a second button per company — "สลับบริษัทและพาไปเว็บไซต์ตาม
 * บริษัทนั้น" in one tap. LINE never tells the server that a `uri` button was pressed, so the
 * LINE-side half of that tap can only happen when the link is opened, i.e. at exchange time.
 *
 * It is scoped to this surface rather than applied to every handoff because the rest of them are
 * links the customer opens on their own schedule — an assistant reply, an alert. Moving the chat
 * they are holding because they read a notification would be a silent, unasked-for change of which
 * shop the next message is about. Only the button that literally says "เปิดเว็บบริษัทนี้" earns it.
 */
export const LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN = 'company_picker_open_web';

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

/**
 * `LineWebHandoffToken.lineUserId` is the CHAT a message was sent to, not always a person: the
 * webhook sets `chatId = groupId ?? roomId ?? userId` (`line-webhook.controller.ts:75`) and the send
 * seams mint with that same chat key. LINE encodes the kind in the first character — `U` + 32 hex
 * is a user, `C` + 32 hex a group, `R` + 32 hex a room — so the prefix is what separates "sent to a
 * person" from "sent to a room full of them".
 *
 * Anything else, including a shape LINE has never issued, answers `false` and so keeps the stricter
 * per-person check: unrecognised means fail closed, never fall open.
 */
export function isLineGroupChatKey(chatKey: string): boolean {
  return /^[CR][0-9a-fA-F]{32}$/.test(chatKey);
}

/** Narrow delegate so this runs on `prisma.client` or a transaction client, and a spec can fake two
 *  lines of it — the shape `session-revocation.logic.ts` uses for the same reason. */
type LineHandoffTokenRevokeDelegate = {
  updateMany(args: {
    where: { lineUserId: string; userId: string; status: 'PENDING' };
    data: { status: 'REVOKED' };
  }): Promise<{ count: number }>;
};

/**
 * Severing a LINE link must also kill the links already sitting in that chat.
 *
 * A PENDING row is a bearer credential with up to `LINE_HANDOFF_TOKEN_TTL_MS` left on it. Unlinking
 * used to drop the identity and the selected-company row and leave every unspent handoff token
 * exchangeable, so a tap inside that window still minted a first-party web session for the account
 * that had just been severed — and a picker-surface token re-created the company context row under
 * a `lineUserId` that may by then belong to somebody else.
 *
 * Matched on `lineUserId` AND `userId` because the row carries both: it kills exactly the links sent
 * to THIS pairing, so re-pointing the same LINE account at another person can neither resurrect the
 * previous holder's tokens nor reach into the new holder's.
 *
 * `REVOKED` is already a value of `LineWebHandoffTokenStatus`, so this needs no migration and no
 * expiry fudge: the exchange's existing `status !== 'PENDING'` check refuses the row as
 * `token_not_pending`, the same generic 403 a used token gets (spec §12), and refuses it at step 2 —
 * before the claim, before any session, and before any surface side effect.
 *
 * Returns the number of links killed, for the severing path's audit row — which spells it
 * `handoffLinksRevoked`, never `...token...`: `audit.service.ts` redacts any metadata key matching
 * that substring, so a count named after tokens reaches the row as `[REDACTED]`.
 */
export async function revokePendingLineHandoffTokens(
  lineWebHandoffToken: LineHandoffTokenRevokeDelegate,
  identity: { lineUserId: string; userId: string },
): Promise<number> {
  const { count } = await lineWebHandoffToken.updateMany({
    where: { lineUserId: identity.lineUserId, userId: identity.userId, status: 'PENDING' },
    data: { status: 'REVOKED' },
  });
  return count;
}


/** Current company state decides the landing at LIFF selection and handoff exchange. */
export function resolveLineHandoffTarget(
  companyId: string,
  targetPath: string,
  company: { status: string; archivedAt?: Date | null; planTerm?: { termEndsAt?: Date; termDisabledAt?: Date | null } | null },
  now = new Date(),
  freeExpenseDrafts = false,
): string | null {
  if (!isSafeHandoffPath(targetPath, companyId) || company.archivedAt) return null;
  const renewal = `/companies/${companyId}/renew`;
  const path = new URL(targetPath, 'https://relative.invalid').pathname;
  const recoveryTarget = path === renewal || isBillingCustomerRecoveryPath(path,companyId) ? targetPath : renewal;
  // This flag is supplied only after the caller re-reads authoritative free eligibility.
  if (freeExpenseDrafts && (company.status === 'ACTIVE' || company.status === 'DISABLED' && company.planTerm?.termDisabledAt)) {
    const expenses = `/companies/${companyId}/expenses`;
    const tail = path.startsWith(`${expenses}/`) ? path.slice(expenses.length + 1) : '';
    const reserved = new Set(['manual', 'new', 'create', 'evidence', 'signatures', 'categories', 'substitute-receipts', 'capture', 'capture-groups']);
    const sourceTarget = path === expenses || tail === 'upload' || /^[A-Za-z0-9_-]+$/.test(tail) && !reserved.has(tail);
    return sourceTarget || path === renewal || isBillingCustomerRecoveryPath(path, companyId) ? targetPath : expenses;
  }

  if (company.status === 'ACTIVE') {
    return company.planTerm?.termEndsAt && company.planTerm.termEndsAt <= now ? recoveryTarget : targetPath;
  }
  // Same expiry-only recovery boundary as the permission resolver. A session grants no
  // business access; the company guard still denies every protected operation until renewed.
  return company.status === 'DISABLED' && company.planTerm?.termDisabledAt ? recoveryTarget : null;
}
