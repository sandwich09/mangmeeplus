import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { ClaimEventDiscountUseCase } from './claim-event-discount.use-case';
import { hashSalesEventQrToken } from '../domain/sales-event-claim.logic';
import { PLATFORM_TENANT_ID } from './sales-context';

// Transactional semantics (the row lock under two concurrent scans, the CHECKs) belong to a real
// PostgreSQL; this harness pins the order of work and what each branch writes.
const now = new Date('2026-10-01T03:00:00.000Z');
const QR = 'q'.repeat(43);
const requestKey = 'request-key-0001';

function harness(options: { identity?: 'none' | 'linked' | 'platform'; verifyFails?: boolean } = {}) {
  const events: string[] = [];
  const charged: string[] = [];
  let state = {
    qr: { tokenHash: hashSalesEventQrToken(QR), batchId: 'batch-1', salesUserId: 'sales-1', expiresAt: new Date(now.getTime() + 60_000) },
    batch: {
      id: 'batch-1', eventName: 'งานแฟร์ SME', state: 'OPEN', revision: 3, version: 7, issueCap: 2, issuedCount: 0,
      discountSatang: 10_000, rewardChatCreditUnits: 5_000, rewardReceiptImageUnits: 20,
      claimStartsAt: new Date('2026-10-01T01:00:00.000Z'), claimEndsAt: new Date('2026-10-01T10:00:00.000Z'),
      scopeJson: { tiers: ['STARTER_249'], intervals: ['month'] },
    },
    agent: { active: true } as { active: boolean } | null,
    profile: { status: 'ACTIVE' },
    tickets: [] as any[],
    audits: [] as any[],
  };
  const lineUserId = 'U-line-1';
  const identityRow = options.identity === 'linked' || options.identity === 'platform'
    ? { userId: 'user-1', status: 'ACTIVE', user: { status: 'ACTIVE' } } : null;
  const ticketView = (ticket: any) => ({ ...ticket, batch: { eventName: state.batch.eventName } });
  const tx = {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => { events.push(`lock:${values[0]}`); return []; },
    salesEventTicket: {
      findUnique: async ({ where }: any) => {
        events.push('replay');
        const key = where.batchId_holderChannelId_holderProviderUserId;
        const found = state.tickets.find((ticket) => ticket.batchId === key.batchId
          && ticket.holderChannelId === key.holderChannelId && ticket.holderProviderUserId === key.holderProviderUserId);
        return found ? ticketView(found) : null;
      },
      create: async ({ data }: any) => {
        events.push('insert');
        const ticket = { id: `ticket-${state.tickets.length + 1}`, state: 'ISSUED', ...data };
        state.tickets.push(ticket);
        return ticketView(ticket);
      },
    },
    salesEventBatch: {
      findUniqueOrThrow: async () => structuredClone(state.batch),
      update: async ({ data }: any) => {
        assert.deepEqual(Object.keys(data), ['issuedCount'], 'a claim never bumps the console version fence');
        state.batch.issuedCount += data.issuedCount.increment; return state.batch;
      },
    },
    salesEventBatchAgent: { findUnique: async () => state.agent },
    salesAgentProfile: { findUnique: async () => state.profile },
    auditLog: { create: async ({ data }: any) => { state.audits.push(data); return {}; } },
  };
  const prisma = { client: {
    ...tx,
    externalIdentity: { findUnique: async ({ where }: any) => {
      assert.deepEqual(where.provider_providerChannelId_providerUserId, { provider: 'LINE', providerChannelId: 'channel-1', providerUserId: lineUserId });
      return identityRow;
    } },
    companyMembership: { findFirst: async ({ where }: any) => {
      assert.equal(where.companyId, PLATFORM_TENANT_ID);
      return options.identity === 'platform' ? { id: 'platform-membership' } : null;
    } },
    salesEventQrToken: { findUnique: async ({ where }: any) => (where.tokenHash === state.qr.tokenHash ? structuredClone(state.qr) : null) },
    $transaction: async (work: any) => {
      events.push('transaction');
      const before = structuredClone(state);
      try { return await work(tx); } catch (error) { state = before; throw error; }
    },
  } } as any;
  const verifier = { verify: async () => {
    events.push('verify');
    if (options.verifyFails) throw new UnauthorizedException('bad token');
    return { providerUserId: lineUserId, channelId: 'channel-1' };
  } } as any;
  const rateLimit = { assertSalesEventClaimAllowed: async (key: string) => { charged.push(key); } } as any;
  const useCase = new ClaimEventDiscountUseCase(prisma, verifier, rateLimit);
  return {
    claim: (at = now, qrToken = QR) => useCase.execute({ idToken: 'a.b.c', qrToken, requestKey, requestId: 'req-1' }, at),
    state: () => state,
    setState: (patch: (current: typeof state) => void) => patch(state),
    events, charged,
  };
}

const code = (expected: string) => (error: any) => error.getResponse().code === expected;

describe('ClaimEventDiscountUseCase', () => {
  it('issues one ticket with the batch values frozen, counts it and audits it without the LINE identity', async () => {
    const h = harness();
    const result = await h.claim();
    assert.deepEqual(result, {
      ticket: { serial: h.state().tickets[0].serial, eventName: 'งานแฟร์ SME', discountSatang: 10_000, chatCreditUnits: 5_000,
        receiptImageUnits: 20, expiresAt: '2026-10-31T10:00:00.000Z' },
      replay: false,
      next: 'SIGN_UP',
    });
    const ticket = h.state().tickets[0];
    assert.match(ticket.serial, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(ticket.batchRevision, 3);
    assert.equal(ticket.salesUserId, 'sales-1');
    assert.equal(ticket.holderProvider, 'LINE');
    assert.equal(ticket.holderChannelId, 'channel-1');
    assert.equal(ticket.holderProviderUserId, 'U-line-1');
    assert.deepEqual(ticket.scopeJson, { tiers: ['STARTER_249'], intervals: ['month'] });
    assert.equal(ticket.claimRequestKey, requestKey);
    for (const unset of ['redeemedAs', 'companyId', 'attemptId', 'invoiceId', 'appliedDiscountSatang']) assert.equal(ticket[unset], undefined, unset);
    assert.equal(h.state().batch.issuedCount, 1);
    assert.equal(h.state().batch.version, 7);
    assert.deepEqual(h.charged, ['U-line-1']);
    assert.deepEqual(h.events, ['verify', 'transaction', 'lock:batch-1', 'replay', 'insert']);
    const [audit] = h.state().audits;
    assert.equal(audit.action, 'sales.event.ticket_claimed');
    assert.equal(audit.targetId, 'ticket-1');
    assert.doesNotMatch(JSON.stringify(audit), /U-line-1|channel-1/);
  });

  it('answers a rescan with the ticket already held, even after the QR ran out', async () => {
    const h = harness();
    const first = await h.claim();
    const again = await h.claim(new Date(now.getTime() + 10 * 60_000));
    assert.equal(again.replay, true);
    assert.deepEqual(again.ticket, first.ticket);
    assert.equal(h.state().tickets.length, 1);
    assert.equal(h.state().batch.issuedCount, 1);
    assert.equal(h.state().audits.length, 1);
  });

  it('points a LINE account linked to มั่งมี at the app instead of signup', async () => {
    assert.equal((await harness({ identity: 'linked' }).claim()).next, 'OPEN_PACKAGE');
  });

  it('refuses the sales team before reading the QR (SD-Q3)', async () => {
    const h = harness({ identity: 'platform' });
    await assert.rejects(h.claim(), (error: any) => error.getStatus() === 403 && code('SALES_EVENT_SELF_CLAIM')(error));
    assert.equal(h.state().tickets.length, 0);
    assert.deepEqual(h.events, ['verify']);
  });

  it('verifies the LINE token before anything else', async () => {
    const h = harness({ verifyFails: true });
    await assert.rejects(h.claim(), UnauthorizedException);
    assert.deepEqual(h.events, ['verify']);
    assert.deepEqual(h.charged, []);
  });

  it('answers an unknown QR as "ใช้ไม่ได้", never as expired (SD-O11)', async () => {
    const h = harness();
    await assert.rejects(h.claim(now, 'x'.repeat(43)), (error: any) => code('SALES_EVENT_QR_INVALID')(error)
      && !/หมดอายุ|สร้าง QR ใหม่/.test(error.getResponse().message));
    assert.equal(h.state().tickets.length, 0);
  });

  it('keeps a printed QR working past its stored expiry and when the lead extends the window (SD-O11)', async () => {
    const h = harness();
    // Issued under the old five-minute rule, printed, and scanned hours later inside the window.
    h.setState((state) => { state.qr.expiresAt = new Date(now.getTime() - 3 * 3_600_000); });
    const later = new Date(now.getTime() + 5 * 3_600_000);
    assert.equal((await h.claim(later)).replay, false);
    // The window closes: the batch refuses it, as a closed batch — not as an expired QR.
    const other = harness();
    other.setState((state) => { state.qr.expiresAt = new Date(now.getTime() - 3 * 3_600_000); });
    const afterEnd = new Date(other.state().batch.claimEndsAt.getTime() + 60_000);
    await assert.rejects(other.claim(afterEnd), code('SALES_EVENT_CLAIM_CLOSED'));
    // The lead extends the window (a new revision): the same printed QR issues, frozen at the new values.
    other.setState((state) => {
      state.batch.claimEndsAt = new Date(afterEnd.getTime() + 86_400_000);
      state.batch.revision = 4;
      state.batch.discountSatang = 15_000;
    });
    const result = await other.claim(afterEnd);
    assert.equal(result.ticket.discountSatang, 15_000);
    assert.equal(other.state().tickets[0].batchRevision, 4);
    assert.equal(result.ticket.expiresAt, new Date(afterEnd.getTime() + 86_400_000 + 30 * 86_400_000).toISOString());
  });

  it('refuses a paused batch, a removed or suspended เซลล์ and a full batch, and writes nothing', async () => {
    const cases: [string, (state: any) => void][] = [
      ['SALES_EVENT_CLAIM_CLOSED', (state) => { state.batch.state = 'PAUSED'; }],
      ['SALES_EVENT_CLAIM_CLOSED', (state) => { state.batch.state = 'SUSPENDED'; }],
      ['SALES_EVENT_CLAIM_CLOSED', (state) => { state.batch.claimEndsAt = now; }],
      ['SALES_EVENT_AGENT_INACTIVE', (state) => { state.agent = { active: false }; }],
      ['SALES_EVENT_AGENT_INACTIVE', (state) => { state.agent = null; }],
      ['SALES_EVENT_AGENT_INACTIVE', (state) => { state.profile = { status: 'SUSPENDED' }; }],
      ['SALES_EVENT_ISSUE_FULL', (state) => { state.batch.issuedCount = 2; }],
    ];
    for (const [expected, patch] of cases) {
      const h = harness();
      h.setState(patch);
      await assert.rejects(h.claim(), code(expected), expected);
      assert.equal(h.state().tickets.length, 0);
      assert.equal(h.state().audits.length, 0);
    }
  });
});
