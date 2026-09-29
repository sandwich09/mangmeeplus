import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eventDiscountPath, holderEventDiscountTickets } from './billing-event-discount';
import { BillingService } from './billing.service';

const now = new Date('2026-10-01T03:00:00.000Z');
const future = new Date('2026-10-31T10:00:00.000Z');

describe('sales-event holder view', () => {
  it('routes a starting shop to the first-bill discount and a paying shop to credit (spec §4.1)', () => {
    for (const source of ['NO_TERM', 'TRIAL', 'ADMIN_MANUAL', 'PAID_EXPIRED_CURRENT_MODE'] as const) assert.equal(eventDiscountPath(source), 'DISCOUNT', source);
    assert.equal(eventDiscountPath('PAID_CURRENT_MODE'), 'CREDIT');
    for (const source of ['PAID_OTHER_MODE', 'SOURCE_INCONSISTENT'] as const) assert.equal(eventDiscountPath(source), null, source);
  });

  it('lists only tickets of the caller’s ACTIVE LINE identities, with plain states and no LINE ids', async () => {
    const queries: any[] = [];
    const db = {
      externalIdentity: { findMany: async (args: any) => { queries.push(args.where); return [{ providerChannelId: 'ch', providerUserId: 'U1' }]; } },
      salesEventTicket: { findMany: async (args: any) => { queries.push(args.where); return [
        { serial: 'AAAA2222', state: 'ISSUED', expiresAt: future, discountSatang: 10_000, rewardChatCreditUnits: 0, rewardReceiptImageUnits: 0,
          batch: { eventName: 'งานหนึ่ง', state: 'SUSPENDED' } },
        { serial: 'BBBB3333', state: 'ISSUED', expiresAt: now, discountSatang: 0, rewardChatCreditUnits: 5_000, rewardReceiptImageUnits: 10,
          batch: { eventName: 'งานสอง', state: 'OPEN' } },
        { serial: 'CCCC4444', state: 'RESERVED', expiresAt: future, discountSatang: 10_000, rewardChatCreditUnits: 0, rewardReceiptImageUnits: 0,
          batch: { eventName: 'งานสาม', state: 'OPEN' } },
      ]; } },
    } as any;
    const tickets = await holderEventDiscountTickets(db, 'user-1', now);
    assert.deepEqual(queries[0], { userId: 'user-1', provider: 'LINE', status: 'ACTIVE' });
    assert.deepEqual(queries[1], { holderProvider: 'LINE', OR: [{ holderChannelId: 'ch', holderProviderUserId: 'U1' }] });
    assert.deepEqual(tickets.map((ticket) => [ticket.serial, ticket.state, ticket.batchSuspended]), [
      ['AAAA2222', 'AVAILABLE', true], ['BBBB3333', 'EXPIRED', false], ['CCCC4444', 'IN_PAYMENT', false],
    ]);
    assert.deepEqual(tickets[1], { serial: 'BBBB3333', eventName: 'งานสอง', discountSatang: 0, chatCreditUnits: 5_000,
      receiptImageUnits: 10, expiresAt: now.toISOString(), state: 'EXPIRED', batchSuspended: false });
  });

  it('LINE read (spec §8.1): the owner-only view, plus why a starting shop may not take the first-bill discount now', async () => {
    const lineRead = (BillingService.prototype as any).lineEventDiscount;
    const tickets = [{ serial: 'AAAA2222' }];
    const context = { userId: 'user-1', companyId: 'company-1' };
    const self = (path: string | null, used: boolean, deal: boolean) => {
      const asked: any[] = [];
      return { asked, eventDiscount: async (ctx: any) => { asked.push(ctx); return { path, tickets }; }, prisma: { client: {
        salesEventTicket: { findFirst: async (args: any) => { asked.push(args.where); return used ? { id: 't' } : null; } },
        packageChangeRequest: { findFirst: async () => deal ? { id: 'd' } : null } } } };
    };
    const starting = self('DISCOUNT', false, false);
    assert.deepEqual(await lineRead.call(starting, context), { path: 'DISCOUNT', tickets, block: null });
    assert.equal(starting.asked[0], context, 'the same owner check as the package page');
    assert.deepEqual(starting.asked[1], { companyId: 'company-1', redeemedAs: 'DISCOUNT', state: { in: ['RESERVED', 'USED'] } });
    assert.equal((await lineRead.call(self('DISCOUNT', true, false), context)).block, 'COMPANY_ALREADY_USED');
    assert.equal((await lineRead.call(self('DISCOUNT', false, true), context)).block, 'DEAL_ACTIVE');
    const paying = self('CREDIT', true, true);
    assert.deepEqual(await lineRead.call(paying, context), { path: 'CREDIT', tickets, block: null });
    assert.equal(paying.asked.length, 1, 'a shop that already has a package reads no first-bill block');
    const denied = { eventDiscount: async () => { throw new Error('ต้องได้รับสิทธิ์จัดการแพ็กเกจบริษัท'); } };
    await assert.rejects(lineRead.call(denied, context), /สิทธิ์จัดการแพ็กเกจ/);
  });

  it('reads no tickets for a login with no LINE linked', async () => {
    const db = { externalIdentity: { findMany: async () => [] },
      salesEventTicket: { findMany: async () => { throw new Error('must not query tickets'); } } } as any;
    assert.deepEqual(await holderEventDiscountTickets(db, 'user-1', now), []);
  });
});
