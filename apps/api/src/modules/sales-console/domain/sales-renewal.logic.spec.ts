import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { digestBodyTh, RENEWAL_LEAD_DAYS, RENEWAL_REMINDER_DAYS } from '../application/sales-renewal.service';
import { workKind } from '../application/sales-deals.service';

/**
 * The Phase 4 pure rules that are NOT part of the counting formula: the renewal windows, the
 * digest text (which must never carry PII) and the my-work kind the console renders.
 */

describe('renewal windows (D3)', () => {
  it('writes the offer 14 days out and chases it at 7', () => {
    assert.equal(RENEWAL_LEAD_DAYS, 14);
    assert.equal(RENEWAL_REMINDER_DAYS, 7);
    assert.ok(RENEWAL_REMINDER_DAYS < RENEWAL_LEAD_DAYS, 'the reminder must fall inside the lead window');
  });
});

describe('daily digest text (§17.2 — counts only, console only)', () => {
  const body = digestBodyTh({ deals: 2, referrals: 3, amountSatang: 1_234_500, flagged: 1,
    renewalsPending: 4, renewalsOverdue: 2 });

  it('reports both channels, the total and every queue', () => {
    assert.match(body, /ดีล 2/);
    assert.match(body, /แนะนำ 3/);
    assert.match(body, /12,345 บาท/);
    assert.match(body, /ต้องตรวจ 1/);
    assert.match(body, /รออนุมัติ 4/);
    assert.match(body, /เตือน 2/);
  });

  it('carries no shop name, agent name, email, phone or id', () => {
    assert.equal(/[A-Za-z]/.test(body.replace(/[^\x00-\x7F]/g, '')), false,
      'a Latin character in the digest means a name or an id leaked into it');
  });

  it('reads sensibly on an empty day', () => {
    const empty = digestBodyTh({ deals: 0, referrals: 0, amountSatang: 0, flagged: 0,
      renewalsPending: 0, renewalsOverdue: 0 });
    assert.match(empty, /ร้านเปิดใหม่เมื่อวาน 0 ร้าน/);
    assert.match(empty, /0 บาท/);
  });
});

describe('my-work kind (Q6 + D3)', () => {
  const deal = (over: { status?: string; renewalOfRequestId?: string | null } = {}) =>
    ({ status: 'PENDING_APPROVAL', renewalOfRequestId: null, ...over } as Parameters<typeof workKind>[0]);

  it('shows an agent their own renewal as DEAL_RENEWAL_PENDING', () => {
    assert.equal(workKind(deal({ renewalOfRequestId: 'deal-1' }), { own: true, lead: false, paymentState: 'NONE' }),
      'DEAL_RENEWAL_PENDING');
  });

  it('keeps the same row in the lead queue, because a lead may approve it (D2)', () => {
    assert.equal(workKind(deal({ renewalOfRequestId: 'deal-1' }), { own: true, lead: true, paymentState: 'NONE' }),
      'APPROVAL_PENDING');
    assert.equal(workKind(deal({ renewalOfRequestId: 'deal-1' }), { own: false, lead: true, paymentState: 'NONE' }),
      'APPROVAL_PENDING');
  });

  it('leaves the Phase 2 kinds exactly as they were', () => {
    assert.equal(workKind(deal({ status: 'CANCELLED' }), { own: true, lead: false, paymentState: 'CATALOG_SUPERSEDED' }),
      'DEAL_SUPERSEDED');
    assert.equal(workKind(deal({ status: 'REJECTED' }), { own: true, lead: false, paymentState: 'NONE' }), 'DEAL_REJECTED');
    assert.equal(workKind(deal({ status: 'EXPIRED' }), { own: true, lead: false, paymentState: 'NONE' }), 'DEAL_EXPIRED');
    assert.equal(workKind(deal({ status: 'APPLIED' }), { own: true, lead: false, paymentState: 'STRIPE_ONE_TIME' }), 'DEAL_APPLIED');
    assert.equal(workKind(deal({ status: 'APPROVED' }), { own: true, lead: false, paymentState: 'NONE' }), 'DEAL_APPROVED_WAITING');
  });
});
