import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SALES_CODE_ALPHABET } from '@watchdog-bms/contracts';
import {
  hashSalesEventQrToken,
  newSalesEventQrToken,
  newSalesEventTicketSerial,
  SALES_EVENT_QR_TOKEN_PATTERN,
  salesEventClaimRefusal,
  salesEventQrLink,
  salesEventTicketDisplayState,
  salesEventTicketExpiresAt,
} from './sales-event-claim.logic';

const now = new Date('2026-10-01T03:00:00.000Z');
const openBatch = {
  state: 'OPEN', claimStartsAt: new Date('2026-10-01T01:00:00.000Z'), claimEndsAt: new Date('2026-10-01T10:00:00.000Z'),
  issueCap: 2, issuedCount: 1,
};
const later = new Date(now.getTime() + 60_000);

describe('sales-event QR token', () => {
  it('is 43 base64url characters and only its sha256 is stored', () => {
    const { rawToken, tokenHash } = newSalesEventQrToken();
    assert.match(rawToken, SALES_EVENT_QR_TOKEN_PATTERN);
    assert.equal(tokenHash, createHash('sha256').update(rawToken).digest('hex'));
    assert.equal(hashSalesEventQrToken(rawToken), tokenHash);
    assert.notEqual(newSalesEventQrToken().rawToken, rawToken);
  });

  it('links to the LIFF sub-path, or to the API page when no LIFF id is configured', () => {
    assert.equal(salesEventQrLink('https://api.example/v1', 'abc', '1234-abcd'), 'https://liff.line.me/1234-abcd/event-discount?t=abc');
    assert.equal(salesEventQrLink('https://api.example/v1', 'abc', null), 'https://api.example/v1/auth/line/link-page/event-discount?t=abc');
    assert.equal(salesEventQrLink('https://api.example/v1', 'abc', 'bad id"'), 'https://api.example/v1/auth/line/link-page/event-discount?t=abc');
  });
});

describe('sales-event ticket', () => {
  it('serial is 8 characters from the no-confusion alphabet', () => {
    for (let index = 0; index < 50; index += 1) {
      const serial = newSalesEventTicketSerial();
      assert.equal(serial.length, 8);
      for (const char of serial) assert.ok(SALES_CODE_ALPHABET.includes(char), serial);
    }
  });

  it('expires 30 days after the batch closes (SD-Q1)', () => {
    assert.equal(salesEventTicketExpiresAt(openBatch.claimEndsAt).toISOString(), '2026-10-31T10:00:00.000Z');
  });

  it('derives expired from time and maps the stored states', () => {
    const future = new Date(now.getTime() + 1);
    assert.equal(salesEventTicketDisplayState({ state: 'ISSUED', expiresAt: future }, now), 'AVAILABLE');
    assert.equal(salesEventTicketDisplayState({ state: 'ISSUED', expiresAt: now }, now), 'EXPIRED');
    assert.equal(salesEventTicketDisplayState({ state: 'RESERVED', expiresAt: now }, now), 'IN_PAYMENT');
    assert.equal(salesEventTicketDisplayState({ state: 'USED', expiresAt: now }, now), 'USED');
    assert.equal(salesEventTicketDisplayState({ state: 'REVOKED', expiresAt: future }, now), 'REVOKED');
  });
});

describe('sales-event claim refusal', () => {
  const refusal = (overrides: Partial<Parameters<typeof salesEventClaimRefusal>[0]>) =>
    salesEventClaimRefusal({ now, batch: openBatch, distributorActive: true, ...overrides });

  it('issues from an open batch inside its window with room left', () => {
    assert.equal(refusal({}), null);
  });

  it('judges the batch as it is at scan time, never the age of the QR (owner 2026-09-29, SD-O11)', () => {
    // A QR printed at the start of the day still works at the end of it: nothing here reads its age.
    assert.equal(refusal({ now: new Date(openBatch.claimEndsAt.getTime() - 1) }), null);
    assert.equal(refusal({ now: openBatch.claimEndsAt }), 'SALES_EVENT_CLAIM_CLOSED');
    // The lead extends the window: the same printed QR works again.
    const extended = { ...openBatch, claimEndsAt: new Date(openBatch.claimEndsAt.getTime() + 86_400_000) };
    assert.equal(refusal({ now: openBatch.claimEndsAt, batch: extended }), null);
  });

  it('refuses a paused or suspended batch and a claim outside [start, end)', () => {
    assert.equal(refusal({ batch: { ...openBatch, state: 'PAUSED' } }), 'SALES_EVENT_CLAIM_CLOSED');
    assert.equal(refusal({ batch: { ...openBatch, state: 'SUSPENDED' } }), 'SALES_EVENT_CLAIM_CLOSED');
    assert.equal(refusal({ batch: { ...openBatch, claimStartsAt: later } }), 'SALES_EVENT_CLAIM_CLOSED');
    assert.equal(refusal({ batch: { ...openBatch, claimEndsAt: now } }), 'SALES_EVENT_CLAIM_CLOSED');
  });

  it('refuses a QR whose เซลล์ was removed, then a full batch', () => {
    assert.equal(refusal({ distributorActive: false }), 'SALES_EVENT_AGENT_INACTIVE');
    assert.equal(refusal({ batch: { ...openBatch, issuedCount: 2 } }), 'SALES_EVENT_ISSUE_FULL');
  });
});
