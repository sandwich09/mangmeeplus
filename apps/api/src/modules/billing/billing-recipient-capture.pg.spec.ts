/**
 * Purchase without setup (pr-c §3/§4.7) against real PostgreSQL. CI's migration review diffs the
 * schema from empty and never compares it with the migration file, so this spec writes and reads every
 * column the migration adds — a column missing from the SQL fails here, not in production.
 *
 * It also proves the capture rules on real rows: the recipient is set only while empty, the address is
 * the latest one seen and never reaches Company, a replay writes nothing, and a stored recipient
 * means no provider call.
 *
 * Run with:
 *   BILLING_RECIPIENT_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/billing-recipient-capture.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { checkoutAddressOf, readRecipientCapture, recordRecipientCapture } from './application/billing-recipient-capture';
import type { BillingSnapshot } from './application/billing.service';

const databaseUrl = process.env.BILLING_RECIPIENT_TEST_DATABASE_URL;
const stripeAddress = { city: 'คลองเตย', country: 'TH', line1: '99 ถนนทดสอบ', line2: null, postal_code: '10110', state: 'กรุงเทพมหานคร' };

describe('billing recipient capture and columns on PostgreSQL', { skip: !databaseUrl }, () => {
  let prisma: PrismaClient;
  const companyIds: string[] = [], userIds: string[] = [];
  before(() => { prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) }); });
  after(async () => {
    await prisma.auditLog.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.billingAccount.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.$disconnect();
  });
  async function account(recipientEmail: string | null = null) {
    const companyId = randomUUID(); companyIds.push(companyId);
    await prisma.company.create({ data: { id: companyId, name: 'Synthetic capture company' } });
    return prisma.billingAccount.create({ data: { companyId, stripeAccountId: `acct_${randomUUID()}`, livemode: false, customerId: `cus_${randomUUID()}`, recipientEmail } });
  }
  const snapshot = (billingEmail: string | null) => ({ quote: { billingEmail } }) as unknown as BillingSnapshot;

  it('stores every new column, including the company on a recipient challenge', async () => {
    const row = await account();
    const bouncedAt = new Date('2026-09-28T01:00:00.000Z'), notifiedAt = new Date('2026-09-28T01:00:05.000Z');
    await prisma.billingAccount.update({ where: { id: row.id }, data: { recipientEmail: 'docs@example.test', recipientSource: 'CUSTOMER_OTP',
      recipientBouncedAt: bouncedAt, recipientBounceNotifiedAt: notifiedAt, checkoutAddressJson: stripeAddress } });
    const stored = await prisma.billingAccount.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual([stored.recipientEmail, stored.recipientSource, stored.recipientBouncedAt?.toISOString(), stored.recipientBounceNotifiedAt?.toISOString()],
      ['docs@example.test', 'CUSTOMER_OTP', bouncedAt.toISOString(), notifiedAt.toISOString()]);
    assert.deepEqual(stored.checkoutAddressJson, stripeAddress);
    assert.equal((await prisma.billingAccount.findMany({ where: { recipientEmail: 'docs@example.test', id: row.id } })).length, 1);
    await assert.rejects(prisma.billingAccount.update({ where: { id: row.id }, data: { recipientEmail: `${'x'.repeat(320)}@example.test` } }));
    const userId = randomUUID(); userIds.push(userId);
    await prisma.user.create({ data: { id: userId, displayName: 'Synthetic capture user' } });
    const token = await prisma.emailVerificationToken.create({ data: { id: randomUUID(), userId, companyId: row.companyId, newEmail: 'new@example.test',
      tokenHash: randomUUID(), proofKind: 'BILLING_RECIPIENT', expiresAt: new Date(Date.now() + 600_000) } });
    assert.equal((await prisma.emailVerificationToken.findFirstOrThrow({ where: { companyId: row.companyId, proofKind: 'BILLING_RECIPIENT', status: 'PENDING' } })).id, token.id);
  });

  it('sets the recipient only while empty, keeps the latest address, audits once and never touches Company', async () => {
    const row = await account();
    const capture = { email: 'typed@example.test', address: stripeAddress };
    await prisma.$transaction(tx => recordRecipientCapture(tx, row, snapshot(null), capture, 'invoice-1', null));
    let stored = await prisma.billingAccount.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.recipientEmail, 'typed@example.test'); assert.equal(stored.recipientSource, 'STRIPE_CHECKOUT');
    assert.deepEqual(stored.checkoutAddressJson, stripeAddress);
    // Replay: same capture, no second audit, no new write.
    const updatedAt = stored.updatedAt;
    await prisma.$transaction(tx => recordRecipientCapture(tx, row, snapshot(null), capture, 'invoice-1', null));
    stored = await prisma.billingAccount.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.updatedAt.getTime(), updatedAt.getTime());
    // A later purchase with a new Checkout address updates the snapshot but never overwrites the recipient.
    const moved = { ...stripeAddress, line1: '100 ถนนใหม่' };
    await prisma.$transaction(tx => recordRecipientCapture(tx, row, snapshot('other@example.test'), { email: 'other@example.test', address: moved }, 'invoice-2', null));
    stored = await prisma.billingAccount.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.recipientEmail, 'typed@example.test'); assert.deepEqual(stored.checkoutAddressJson, moved);
    const audits = await prisma.auditLog.findMany({ where: { companyId: row.companyId, action: 'billing.recipient.captured' } });
    assert.equal(audits.length, 1); assert.deepEqual(audits[0]!.metadataJson, { source: 'STRIPE_CHECKOUT', addressCaptured: true });
    assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: row.companyId } })).addressJson, null);
    assert.deepEqual(checkoutAddressOf(stored.checkoutAddressJson), { line1: '100 ถนนใหม่', line2: null, subdistrict: '', district: 'คลองเตย',
      province: 'กรุงเทพมหานคร', postalCode: '10110' });
  });

  it('marks a pinned account email as ACCOUNT_EMAIL and reads the Customer only while the recipient is empty', async () => {
    const empty = await account(), calls: string[] = [];
    const stripe = { request: async (_method: string, path: string) => { calls.push(path);
      return { id: empty.customerId, metadata: { billingAccountId: empty.id }, email: ' Owner@Example.test ', address: stripeAddress }; } };
    const session = { customer_details: { email: 'owner@example.test', address: stripeAddress } };
    assert.deepEqual(await readRecipientCapture(stripe as any, empty, session), { email: 'owner@example.test', address: stripeAddress });
    assert.equal(calls.length, 0, 'a completed session carries the details');
    const fromCustomer = await readRecipientCapture(stripe as any, empty, null);
    assert.deepEqual(fromCustomer, { email: 'owner@example.test', address: stripeAddress }); assert.deepEqual(calls, [`/customers/${empty.customerId}`]);
    await prisma.$transaction(tx => recordRecipientCapture(tx, empty, snapshot('owner@example.test'), fromCustomer, 'invoice-1', null));
    assert.equal((await prisma.billingAccount.findUniqueOrThrow({ where: { id: empty.id } })).recipientSource, 'ACCOUNT_EMAIL');
    const stored = await account('docs@example.test');
    assert.equal(await readRecipientCapture(stripe as any, stored, null), null); assert.equal(calls.length, 1, 'no provider call once a recipient is stored');
    await assert.rejects(readRecipientCapture({ request: async () => ({ id: 'cus_other', metadata: {} }) } as any, empty, null), /customer_binding/);
  });
});
