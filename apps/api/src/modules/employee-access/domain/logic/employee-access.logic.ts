import { createHash, createHmac, randomBytes } from 'node:crypto';
import qrcode from 'qrcode-generator';
import { hashPassword } from '../../../auth/domain/logic/password-credential.logic';

const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;
const LINE_LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

/** OWNER is the protected last-owner role; SYSTEM_ADMIN is a platform-only role. Neither is assignable to company staff. */
export const NON_ASSIGNABLE_ROLE_KEYS = ['OWNER', 'SYSTEM_ADMIN'];
export const FINANCIAL_ROLE_KEYS = ['FINANCE', 'ACCOUNTANT'];
export const FINANCIAL_ROLE_ASSIGN_PERMISSION = 'access.role.financial.assign';

/**
 * Team decision 2026-07-28: company-wide reimbursement visibility (who is still owed
 * money) may be granted to additional roles, but only by the company owner. Gated on
 * the owner-only financial-assign permission, so an ADMIN — who holds these keys and
 * access.role.manage — cannot hand the visibility out through a custom role.
 */
export const OWNER_GATED_GRANT_KEYS = ['reimbursement.read'];

/** Non-owner composing a role that grants owner-gated visibility → violation message. */
export function ownerGatedGrantViolation(
  finalPermissionKeys: string[],
  granterPermissionKeys: ReadonlySet<string> | null,
): string | undefined {
  if (!granterPermissionKeys || granterPermissionKeys.has(FINANCIAL_ROLE_ASSIGN_PERMISSION)) return undefined;
  const gated = OWNER_GATED_GRANT_KEYS.find((key) => finalPermissionKeys.includes(key));
  return gated ? `Granting ${gated} to a role requires the company owner.` : undefined;
}

export type GrantCandidateRole = { key: string; permissionKeys: string[] };

export function roleGrantViolation(roles: GrantCandidateRole[], requesterPermissions: readonly string[], requesterIsOwner = false): string | undefined {
  const granted = new Set(requesterPermissions);
  if (roles.some((role) => NON_ASSIGNABLE_ROLE_KEYS.includes(role.key))) {
    return 'OWNER and SYSTEM_ADMIN access cannot be granted through employee provisioning.';
  }
  // OWNER grants every company permission by definition, while its effective permissions may be
  // feature-filtered and candidate system roles still expose their raw permission rows.
  if (requesterIsOwner) return undefined;
  if (roles.some((role) => role.permissionKeys.some((permission) => !granted.has(permission)))) {
    return 'A role cannot grant permissions that the requesting user does not hold.';
  }
  if (roles.some((role) => FINANCIAL_ROLE_KEYS.includes(role.key)) && !granted.has(FINANCIAL_ROLE_ASSIGN_PERMISSION)) {
    return 'Finance and Accountant role assignment requires owner approval.';
  }
}

// Escalation-guard list shared with the web role picker — canonical copy lives in contracts.
export { PRIVILEGED_GRANT_KEYS, hasPrivilegedGrant } from '@watchdog-bms/contracts';

/** Strips formatting so Thai national ID / passport values compare equal regardless of dashes/spaces/case. */
export function normalizeIdentityNumber(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function identityLast4(raw: string): string {
  const normalized = normalizeIdentityNumber(raw);
  return normalized.slice(-4);
}

/** Deterministic, non-reversible reference for in-company duplicate detection. Never decrypted. */
export function hashIdentityNumber(raw: string, key: Buffer): string {
  return createHmac('sha256', key).update(normalizeIdentityNumber(raw)).digest('hex');
}

export function maskIdentityNumber(last4: string): string {
  return `*********${last4}`;
}

// ponytail: 9 bytes -> 12 base64 chars, safe charset; mirrors system-onboarding temp password generator
export function generateTemporaryPassword(): string {
  return randomBytes(9).toString('base64').replace(/[+/=]/g, 'x');
}

export function temporaryPasswordExpiry(now: Date): Date {
  return new Date(now.getTime() + TEMP_PASSWORD_TTL_MS);
}

export function hashTemporaryPassword(plain: string): string {
  return hashPassword(plain);
}

export function employeePasswordFromDateOfBirth(dateOfBirth: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth);
  if (!match) throw new Error('Employee date of birth is required.');
  return `${match[3]}${match[2]}${match[1]}`;
}

function slugifyDisplayName(displayName: string): string {
  return displayName
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    .slice(0, 20);
}

/** Login username candidate; caller retries with a new call on uniqueness collision. */
export function generateUsernameCandidate(displayName: string): string {
  const slug = slugifyDisplayName(displayName) || 'emp';
  return `${slug}.${randomBytes(3).toString('hex')}`;
}

export function generateLineLinkToken(ttlMs: number = LINE_LINK_TOKEN_TTL_MS): { rawToken: string; tokenHash: string; expiresAt: Date } {
  const rawToken = randomBytes(24).toString('base64url');
  return {
    rawToken,
    tokenHash: hashLineLinkToken(rawToken),
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

export function hashLineLinkToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Owner handoff QR lives 72h, matching the temporary-password window (spec + owner decision
 *  2026-08-10; previously capped at 24h under H-09). It stays single-use and bound to the owner
 *  membership, and SYSTEM_ADMIN can still reissue via reissue-owner-line-link (QR only,
 *  password untouched). */
export const OWNER_LINE_LINK_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

export function buildLineLinkPackage(apiBaseUrl: string, rawToken: string, expiresAt: Date, lineLiffId?: string): {
  linkUrl: string;
  qrImageUrl: string;
  expiresAt: string;
} {
  // The LIFF universal link opens inside LINE on mobile; a raw HTTPS endpoint is
  // commonly opened by the phone browser where liff.init can fail. Local/dev keeps
  // the direct endpoint fallback.
  const liffId = lineLiffId && /^[A-Za-z0-9._-]{1,128}$/.test(lineLiffId) ? lineLiffId : undefined;
  const linkUrl = liffId
    ? `https://liff.line.me/${liffId}/employee?token=${encodeURIComponent(rawToken)}`
    : `${apiBaseUrl}/auth/line/link-page/employee?token=${encodeURIComponent(rawToken)}`;
  return {
    linkUrl,
    qrImageUrl: qrSvgDataUrl(linkUrl),
    expiresAt: expiresAt.toISOString(),
  };
}

/** The link URL is a bearer credential: render the QR locally so it never leaves as a
 *  query param to a third-party image service (H-09). */
function qrSvgDataUrl(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  // createSvgTag emits only the dark modules on a transparent background; inject an
  // opaque white rect so a saved/forwarded image stays scannable on dark surfaces.
  const svg = qr
    .createSvgTag({ cellSize: 4, margin: 16 })
    .replace('>', '><rect width="100%" height="100%" fill="#ffffff"/>');
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
