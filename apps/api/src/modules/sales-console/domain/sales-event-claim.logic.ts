/**
 * Sales-event discounts: the QR a เซลล์ shows and the ticket a scan issues
 * (docs/specs/sales-event-discounts-spec-th.md §3.2, §3.3, §4.4, §6.1, §6.4).
 *
 * One file both sides import, so the console that ISSUES a QR (SD-A) and the claim that FINDS it
 * (SD-B) cannot drift apart on the token shape, its hash or the link it opens.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  SALES_CODE_ALPHABET,
  SALES_EVENT_TICKET_VALID_DAYS,
  type SalesEventTicketDisplayState,
} from '@watchdog-bms/contracts';

/** 32 random bytes as base64url: always 43 characters. */
export const SALES_EVENT_QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** The number people read out: 8 characters with no 0/O or 1/I. */
export const SALES_EVENT_TICKET_SERIAL_LENGTH = 8;
/** LIFF sub-path of the registered endpoint `…/v1/auth/line/link-page`. */
export const SALES_EVENT_LIFF_PATH = 'event-discount';

/** Only the hash is stored (`SalesEventQrToken.tokenHash`); the raw token lives in the QR image. */
export function hashSalesEventQrToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function newSalesEventQrToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('base64url');
  return { rawToken, tokenHash: hashSalesEventQrToken(rawToken) };
}

/**
 * The link inside the QR. The LIFF universal link opens inside LINE on a phone; without a LIFF id
 * (local/dev) the API page is linked directly — the same rule as `buildLineLinkPackage`.
 */
export function salesEventQrLink(apiBaseUrl: string, rawToken: string, lineLiffId?: string | null): string {
  const liffId = lineLiffId && /^[A-Za-z0-9._-]{1,128}$/.test(lineLiffId) ? lineLiffId : undefined;
  const query = `t=${encodeURIComponent(rawToken)}`;
  return liffId
    ? `https://liff.line.me/${liffId}/${SALES_EVENT_LIFF_PATH}?${query}`
    : `${apiBaseUrl}/auth/line/link-page/${SALES_EVENT_LIFF_PATH}?${query}`;
}

export function newSalesEventTicketSerial(): string {
  let serial = '';
  for (let index = 0; index < SALES_EVENT_TICKET_SERIAL_LENGTH; index += 1) {
    serial += SALES_CODE_ALPHABET[randomInt(SALES_CODE_ALPHABET.length)];
  }
  return serial;
}

/** SD-Q1: the batch's claim end at the revision the ticket was issued under, plus 30 days. */
export function salesEventTicketExpiresAt(claimEndsAt: Date): Date {
  return new Date(claimEndsAt.getTime() + SALES_EVENT_TICKET_VALID_DAYS * 86_400_000);
}

export type SalesEventClaimRefusal =
  | 'SALES_EVENT_CLAIM_CLOSED'
  | 'SALES_EVENT_AGENT_INACTIVE'
  | 'SALES_EVENT_ISSUE_FULL';

/**
 * Why a NEW ticket cannot be issued from this QR right now, or null. A person who already holds a
 * ticket from the batch never reaches this: the claim answers with that ticket first (spec §3.3).
 * Read under the batch row lock, so the cap check cannot race another scan.
 *
 * Owner 2026-09-29 (SD-O11): a QR has no clock of its own — it may be printed or shown on a screen.
 * Everything is judged by the batch AS IT IS NOW: a lead who extends the window extends every QR
 * already printed, and "พักแจก", "ระงับการใช้" or taking the เซลล์ off the batch stops them at once.
 */
export function salesEventClaimRefusal(input: {
  now: Date;
  batch: { state: string; claimStartsAt: Date; claimEndsAt: Date; issueCap: number; issuedCount: number };
  /** The เซลล์ is still an active distributor of the batch and their account is usable. */
  distributorActive: boolean;
}): SalesEventClaimRefusal | null {
  const { now, batch } = input;
  if (batch.state !== 'OPEN' || now < batch.claimStartsAt || now >= batch.claimEndsAt) return 'SALES_EVENT_CLAIM_CLOSED';
  if (!input.distributorActive) return 'SALES_EVENT_AGENT_INACTIVE';
  if (batch.issuedCount >= batch.issueCap) return 'SALES_EVENT_ISSUE_FULL';
  return null;
}

/** Spec §6.3: "expired" is not stored — an ISSUED ticket whose `expiresAt` has passed. */
export function salesEventTicketDisplayState(ticket: { state: string; expiresAt: Date }, now: Date): SalesEventTicketDisplayState {
  if (ticket.state === 'RESERVED') return 'IN_PAYMENT';
  if (ticket.state === 'USED') return 'USED';
  if (ticket.state === 'REVOKED') return 'REVOKED';
  return ticket.expiresAt <= now ? 'EXPIRED' : 'AVAILABLE';
}
