import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { BillingService } from './application/billing.service';

const databaseUrl = process.env.BILLING_SETTINGS_TEST_DATABASE_URL;
test('concurrent first settings reads create one closed baseline and preserve subsequent operator changes', { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.ok(['/mangmee_ux', '/watchdog_postmark_ci'].includes(url.pathname));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const stripeAccountId = `acct_SettingsRace${randomUUID().replaceAll('-', '')}`;
  const service = { prisma: { client }, stripe: { accountId: stripeAccountId, livemode: false } } as unknown as BillingService;
  const read = () => BillingService.prototype.settings.call(service);
  try {
    const results = await Promise.all(Array.from({ length: 12 }, read));
    assert.equal(new Set(results.map(result => result.settings.id)).size, 1);
    assert.equal(await client.billingSettings.count({ where: { stripeAccountId } }), 1);
    assert.ok(Object.values(results[0]!.gates).every(value => value === false));
    await client.billingSettings.update({ where: { id: results[0]!.settings.id }, data: { version: 7, gatesJson: { new_sales: true } } });
    const reread = await Promise.all(Array.from({ length: 6 }, read));
    assert.ok(reread.every(result => result.settings.version === 7 && result.gates.new_sales));
  } finally {
    await client.billingSettings.deleteMany({ where: { stripeAccountId } });
    await client.$disconnect();
  }
});
