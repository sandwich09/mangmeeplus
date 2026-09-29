/**
 * Sales-event claim (SD-B) against real PostgreSQL: what an in-memory fake cannot show.
 *
 * 1. The batch row lock under two concurrent scans: cap = 1 hands out exactly one ticket, and one
 *    person scanning twice at once gets one ticket back twice.
 * 2. The migration's CHECKs accept the row a claim writes (ISSUED, nothing redeemed, amounts copied).
 * 3. The platform-tenant refusal and a removed เซลล์, end to end through the real tables.
 * 4. A printed QR (owner 2026-09-29, SD-O11): the batch as it is at scan time decides, not the QR's age.
 *
 * Run with a disposable database that has every migration applied:
 *   SALES_EVENT_CLAIM_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     pnpm --filter @watchdog-bms/api exec tsx --test src/modules/sales-console/claim-event-discount.pg.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { ClaimEventDiscountUseCase } from './application/claim-event-discount.use-case';
import { PLATFORM_TENANT_ID } from './application/sales-context';
import { newSalesEventQrToken } from './domain/sales-event-claim.logic';

const databaseUrl = process.env.SALES_EVENT_CLAIM_TEST_DATABASE_URL;
const CHANNEL = 'channel-claim-ci';

async function harness(issueCap: number) {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
  assert.ok(url.pathname === '/watchdog_bms' || url.pathname.endsWith('_ci'), `refusing to write to ${url.pathname}`);
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const tag = `claim-${randomUUID().slice(0, 8)}`;
  const salesUserId = `${tag}-sales`;
  const now = new Date();

  await client.company.upsert({ where: { id: PLATFORM_TENANT_ID }, update: {},
    create: { id: PLATFORM_TENANT_ID, name: 'มั่งมีพลัส · ระบบภายใน', status: 'ACTIVE' } });
  await client.user.create({ data: { id: salesUserId, username: salesUserId, displayName: 'เซลล์ทดสอบ', status: 'ACTIVE' } });
  await client.salesAgentProfile.create({ data: { userId: salesUserId, salesCode: tag.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'Z'),
    status: 'ACTIVE', createdByUserId: salesUserId } });
  const batch = await client.salesEventBatch.create({ data: {
    eventName: `งานทดสอบ ${tag}`, batchName: 'ชุดแรก', discountSatang: 10_000, rewardChatCreditUnits: 5_000,
    rewardReceiptImageUnits: 20, issueCap, claimStartsAt: new Date(now.getTime() - 3_600_000),
    claimEndsAt: new Date(now.getTime() + 3_600_000), scopeJson: { tiers: ['STARTER_249'], intervals: ['month'] },
    createdByUserId: salesUserId,
  } });
  await client.salesEventBatchAgent.create({ data: { batchId: batch.id, salesUserId, addedByUserId: salesUserId } });
  const { rawToken, tokenHash } = newSalesEventQrToken();
  await client.salesEventQrToken.create({ data: { tokenHash, batchId: batch.id, salesUserId, batchRevision: batch.revision,
    expiresAt: new Date(now.getTime() + 300_000) } });

  // The ID token IS the LINE user id here: verification is LineIdTokenService's own spec.
  const verifier = { verify: async (idToken: string) => ({ providerUserId: idToken, channelId: CHANNEL }) } as never;
  const rateLimit = { assertSalesEventClaimAllowed: async () => {} } as never;
  const useCase = new ClaimEventDiscountUseCase({ client } as never, verifier, rateLimit);
  const claim = (lineUserId: string) => useCase.execute({ idToken: lineUserId, qrToken: rawToken,
    requestKey: `${tag}-${lineUserId}`.slice(0, 120), requestId: `${tag}-req` });

  return {
    client, tag, batch, salesUserId, claim,
    async teardown() {
      await client.auditLog.deleteMany({ where: { requestId: `${tag}-req` } });
      await client.salesEventTicket.deleteMany({ where: { batchId: batch.id } });
      await client.salesEventBatch.deleteMany({ where: { id: batch.id } });
      await client.companyMembership.deleteMany({ where: { userId: { startsWith: tag } } });
      await client.externalIdentity.deleteMany({ where: { userId: { startsWith: tag } } });
      await client.salesAgentProfile.deleteMany({ where: { userId: salesUserId } });
      await client.user.deleteMany({ where: { id: { startsWith: tag } } });
      await client.$disconnect();
    },
  };
}

const code = async (work: Promise<unknown>) => {
  try { await work; return 'ok'; } catch (error) { return (error as { response?: { code?: string } }).response?.code ?? String(error); }
};

describe('sales-event claim against PostgreSQL', { skip: !databaseUrl && 'set SALES_EVENT_CLAIM_TEST_DATABASE_URL' }, () => {
  it('hands out exactly one ticket when two people scan a cap-1 batch at once', async () => {
    const h = await harness(1);
    try {
      const outcomes = await Promise.all([code(h.claim(`${h.tag}-a`)), code(h.claim(`${h.tag}-b`))]);
      assert.deepEqual(outcomes.sort(), ['SALES_EVENT_ISSUE_FULL', 'ok']);
      const batch = await h.client.salesEventBatch.findUniqueOrThrow({ where: { id: h.batch.id } });
      assert.equal(batch.issuedCount, 1);
      assert.equal(batch.version, h.batch.version, 'a claim never moves the console edit fence');
      const tickets = await h.client.salesEventTicket.findMany({ where: { batchId: h.batch.id } });
      assert.equal(tickets.length, 1);
      const [ticket] = tickets;
      assert.equal(ticket!.state, 'ISSUED');
      assert.equal(ticket!.redeemedAs, null);
      assert.equal(ticket!.companyId, null);
      assert.equal(ticket!.discountSatang, 10_000);
      assert.equal(ticket!.rewardChatCreditUnits, 5_000);
      assert.equal(ticket!.rewardReceiptImageUnits, 20);
      assert.equal(ticket!.batchRevision, h.batch.revision);
      assert.equal(ticket!.salesUserId, h.salesUserId);
      assert.equal(ticket!.holderChannelId, CHANNEL);
      assert.equal(ticket!.expiresAt.getTime(), h.batch.claimEndsAt.getTime() + 30 * 86_400_000);
      assert.deepEqual(ticket!.scopeJson, { tiers: ['STARTER_249'], intervals: ['month'] });
      const audits = await h.client.auditLog.findMany({ where: { requestId: `${h.tag}-req`, action: 'sales.event.ticket_claimed' } });
      assert.equal(audits.length, 1);
      assert.doesNotMatch(JSON.stringify(audits[0]!.metadataJson), new RegExp(`${h.tag}-(a|b)`));
    } finally { await h.teardown(); }
  });

  it('gives one person scanning twice at once the same ticket', async () => {
    const h = await harness(5);
    try {
      const [first, second] = await Promise.all([h.claim(`${h.tag}-a`), h.claim(`${h.tag}-a`)]);
      assert.equal(first.ticket.serial, second.ticket.serial);
      assert.deepEqual([first.replay, second.replay].sort(), [false, true]);
      assert.equal((await h.client.salesEventBatch.findUniqueOrThrow({ where: { id: h.batch.id } })).issuedCount, 1);
    } finally { await h.teardown(); }
  });

  it('keeps a printed QR working until the batch closes, again when the window is extended, and stops it on pause or suspend', async () => {
    const h = await harness(5);
    try {
      const batchWhere = { id: h.batch.id };
      // Printed long ago: its stored expiry passed hours ago, the batch is still open.
      await h.client.salesEventQrToken.updateMany({ where: { batchId: h.batch.id }, data: { expiresAt: new Date(Date.now() - 3 * 3_600_000) } });
      assert.equal(await code(h.claim(`${h.tag}-a`)), 'ok');

      // The window closes: refused as a closed batch.
      await h.client.salesEventBatch.update({ where: batchWhere, data: { claimEndsAt: new Date(Date.now() - 60_000) } });
      assert.equal(await code(h.claim(`${h.tag}-b`)), 'SALES_EVENT_CLAIM_CLOSED');

      // The lead extends it (a new revision with a bigger discount): the same printed QR issues again,
      // and the ticket freezes the batch's CURRENT values.
      const newEnd = new Date(Date.now() + 2 * 3_600_000);
      await h.client.salesEventBatch.update({ where: batchWhere,
        data: { claimEndsAt: newEnd, revision: { increment: 1 }, version: { increment: 1 }, discountSatang: 15_000 } });
      const extended = await h.claim(`${h.tag}-b`);
      assert.equal(extended.ticket.discountSatang, 15_000);
      assert.equal(extended.ticket.expiresAt, new Date(newEnd.getTime() + 30 * 86_400_000).toISOString());
      const ticket = await h.client.salesEventTicket.findFirstOrThrow({ where: { batchId: h.batch.id, holderProviderUserId: `${h.tag}-b` } });
      assert.equal(ticket.batchRevision, h.batch.revision + 1);

      // "พักแจก" and "ระงับการใช้" stop the printed QR at once.
      await h.client.salesEventBatch.update({ where: batchWhere, data: { state: 'PAUSED' } });
      assert.equal(await code(h.claim(`${h.tag}-c`)), 'SALES_EVENT_CLAIM_CLOSED');
      await h.client.salesEventBatch.update({ where: batchWhere, data: { state: 'SUSPENDED' } });
      assert.equal(await code(h.claim(`${h.tag}-c`)), 'SALES_EVENT_CLAIM_CLOSED');
      assert.equal(await h.client.salesEventTicket.count({ where: { batchId: h.batch.id } }), 2);

      // A token that was never issued is "ใช้ไม่ได้", never "expired".
      const { rawToken } = newSalesEventQrToken();
      assert.equal(await code(new ClaimEventDiscountUseCase({ client: h.client } as never,
        { verify: async () => ({ providerUserId: `${h.tag}-d`, channelId: CHANNEL }) } as never,
        { assertSalesEventClaimAllowed: async () => {} } as never)
        .execute({ idToken: 'x', qrToken: rawToken, requestKey: `${h.tag}-unknown`, requestId: `${h.tag}-req` })), 'SALES_EVENT_QR_INVALID');
    } finally { await h.teardown(); }
  });

  it('refuses the sales team and a QR whose เซลล์ was removed', async () => {
    const h = await harness(5);
    try {
      const staffId = `${h.tag}-staff`;
      await h.client.user.create({ data: { id: staffId, username: staffId, displayName: 'ทีมงาน', status: 'ACTIVE' } });
      await h.client.companyMembership.create({ data: { companyId: PLATFORM_TENANT_ID, userId: staffId, status: 'ACTIVE' } });
      await h.client.externalIdentity.create({ data: { userId: staffId, provider: 'LINE', providerChannelId: CHANNEL, providerUserId: `${h.tag}-staff-line` } });
      assert.equal(await code(h.claim(`${h.tag}-staff-line`)), 'SALES_EVENT_SELF_CLAIM');

      await h.client.salesEventBatchAgent.update({ where: { batchId_salesUserId: { batchId: h.batch.id, salesUserId: h.salesUserId } },
        data: { active: false, removedAt: new Date() } });
      assert.equal(await code(h.claim(`${h.tag}-c`)), 'SALES_EVENT_AGENT_INACTIVE');
      assert.equal(await h.client.salesEventTicket.count({ where: { batchId: h.batch.id } }), 0);
    } finally { await h.teardown(); }
  });
});
