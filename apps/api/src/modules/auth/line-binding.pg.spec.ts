import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { ExchangeLineTokenUseCase } from './application/use-cases/exchange-line-token.use-case';

const databaseUrl = process.env.AUTH_LINE_BINDING_TEST_DATABASE_URL;

/** Real identity queries; LINE verification and token issuance are explicit test boundaries. */
describe('canonical LINE binding PostgreSQL boundary', { skip: !databaseUrl }, () => {
  it('keeps unlink/disable authoritative over a legacy alias, and preserves valid legacy login before repair', async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci'].includes(url.pathname));
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const tag = `line-binding-${randomUUID()}`, currentUser = `${tag}-current`, legacyUser = `${tag}-legacy`;
    const subject = `${tag}-subject`, channel = `${tag}-messaging`, issued: string[] = [];
    const exchange = new ExchangeLineTokenUseCase(
      { verify: async () => ({ subject }) } as any,
      { client } as any,
      { lineMessagingChannelId: channel, isProduction: true } as any,
      { execute: async (userId: string) => { issued.push(userId); return { accessToken: 'synthetic', refreshToken: 'synthetic', expiresIn: 900 }; } } as any,
    );
    try {
      await client.user.createMany({ data: [{ id: currentUser, displayName: tag }, { id: legacyUser, displayName: tag }] });
      const legacy = await client.externalIdentity.create({ data: { userId: legacyUser, provider: 'LINE', providerUserId: subject, providerChannelId: `${tag}-login` } });
      assert.equal((await exchange.execute('synthetic-id-token', channel)).linked, true);
      assert.deepEqual(issued.splice(0), [legacyUser]);
      const canonical = await client.externalIdentity.create({ data: { userId: currentUser, provider: 'LINE', providerUserId: subject, providerChannelId: channel } });
      for (const status of ['ACTIVE', 'UNLINKED', 'DISABLED', 'ACTIVE'] as const) {
        await client.externalIdentity.update({ where: { id: canonical.id }, data: { status } });
        assert.equal((await exchange.execute('synthetic-id-token', channel)).linked, status === 'ACTIVE');
        assert.deepEqual(issued.splice(0), status === 'ACTIVE' ? [currentUser] : []);
        assert.deepEqual(await client.externalIdentity.findUniqueOrThrow({ where: { id: legacy.id } }), legacy);
      }
    } finally {
      await client.externalIdentity.deleteMany({ where: { userId: { in: [currentUser, legacyUser] } } });
      await client.user.deleteMany({ where: { id: { in: [currentUser, legacyUser] } } });
      await client.$disconnect();
    }
  });
});
