// P12-3a desktop QR login (master plan §13.6E). Pure helpers: credential minting, hashing and
// scan-URL building. No Nest, no Prisma — the use cases own persistence and policy.
import { createHash, randomBytes } from 'node:crypto';
import { qrSvgDataUrl } from '../../../employee-access/domain/logic/employee-access.logic';

/** AUTH-03: the QR is a transaction, not a durable code. Three minutes is long enough to pick up
 *  the phone and short enough that a photographed screen is worthless. */
export const LINE_WEB_QR_TTL_MS = 3 * 60_000;

/**
 * Two independent bearer halves for one transaction: `publicCode` travels in the QR and is
 * presented by the scanning phone, `desktopSecret` never leaves the desktop's HttpOnly cookie and
 * is presented when polling. Knowing one must not yield the other, so they are minted separately.
 */
export function generateLineWebQrCredentials(): { publicCode: string; desktopSecret: string } {
  return {
    publicCode: randomBytes(24).toString('base64url'),
    desktopSecret: randomBytes(24).toString('base64url'),
  };
}

/** Same non-reversible shape as the employee link token: only the hash is ever stored. */
export function hashLineWebQrValue(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** The page the phone opens after scanning; the code is a path segment, not a query param. */
export function lineWebQrScanUrl(webBase: string, publicCode: string): string {
  return `${webBase.replace(/\/+$/, '')}/line-qr/${encodeURIComponent(publicCode)}`;
}

/** Rendered locally (H-09): a one-time login code must never be handed to an external QR service. */
export function lineWebQrImageUrl(scanUrl: string): string {
  return qrSvgDataUrl(scanUrl);
}
