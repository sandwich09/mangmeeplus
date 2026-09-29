/**
 * Add-on foundation (chat credit and receipt image plan PR A; spec §8.2, §9.1, A13/AO-E68) against real
 * PostgreSQL. A release gate: it writes and reads every column `20260929120000_billing_product_foundation`
 * adds, proves the add-on slot is unique, that the one "latest package invoice" read every package reader
 * uses skips a newer add-on invoice, and that the reconciler refuses an add-on snapshot before any Stripe call.
 *
 * Run with:
 *   BILLING_PRODUCT_FOUNDATION_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/billing-product-foundation.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../../common/database/prisma.service';
import { latestPackageInvoice } from './application/billing.service';
import { BillingReconcilerService } from './application/billing-reconciler.service';

const databaseUrl = process.env.BILLING_PRODUCT_FOUNDATION_TEST_DATABASE_URL;

describe('billing product foundation on PostgreSQL', { skip: !databaseUrl }, () => {
  let client: PrismaClient;
  const companyIds: string[] = [], accountIds: string[] = [];
  before(() => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_ci'), 'only a disposable local *_ci database');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  });
  after(async () => {
    await client.billingInvoice.deleteMany({ where: { billingAccountId: { in: accountIds } } });
    await client.billingAccount.updateMany({ where: { id: { in: accountIds } }, data: { activeAttemptId: null, activeAddOnAttemptId: null } });
    await client.billingAttempt.deleteMany({ where: { billingAccountId: { in: accountIds } } });
    await client.billingAccount.deleteMany({ where: { id: { in: accountIds } } });
    await client.company.deleteMany({ where: { id: { in: companyIds } } });
    await client.$disconnect();
  });

  async function account() {
    const run = randomUUID().replaceAll('-', ''), companyId = `foundation-${run}`;
    companyIds.push(companyId);
    await client.company.create({ data: { id: companyId, name: 'Synthetic add-on foundation company' } });
    const row = await client.billingAccount.create({ data: { companyId, stripeAccountId: `acct_${run}`, livemode: false, customerId: `cus_${run}` } });
    accountIds.push(row.id);
    return row;
  }
  const attempt = (billingAccountId: string, extra: Partial<Prisma.BillingAttemptUncheckedCreateInput> = {}) => client.billingAttempt.create({ data: {
    billingAccountId, initiatingUserId: 'synthetic', quoteId: randomUUID(), channel: 'web', idempotencyKey: randomUUID(), requestHash: 'synthetic',
    quoteSnapshot: {}, policyRevisionId: 'synthetic-policy', consentRevision: 'synthetic', consentAt: new Date(), ...extra } });
  const invoice = (billingAccountId: string, periodStart: Date, periodEnd: Date, extra: Partial<Prisma.BillingInvoiceUncheckedCreateInput> = {}) =>
    client.billingInvoice.create({ data: { billingAccountId, providerInvoiceId: `in_${randomUUID().replaceAll('-', '')}`, offerSnapshot: {},
      policyRevisionId: 'synthetic-policy', currency: 'thb', totalSatang: 29900, paidSatang: 29900, periodStart, periodEnd,
      providerStatus: 'paid', evidenceHash: 'synthetic', applyStatus: 'APPLIED', appliedAt: periodEnd, ...extra } });

  it('defaults every existing shape to PACKAGE and round-trips each new column', async () => {
    const row = await account();
    assert.equal(row.activeAddOnAttemptId, null);
    const packageAttempt = await attempt(row.id), addOnAttempt = await attempt(row.id, { productKind: 'CHAT_CREDIT' });
    assert.deepEqual([packageAttempt.productKind, addOnAttempt.productKind], ['PACKAGE', 'CHAT_CREDIT']);
    const at = new Date('2026-09-29T03:00:00.000Z');
    const packageInvoice = await invoice(row.id, at, at), addOnInvoice = await invoice(row.id, at, at, { productKind: 'RECEIPT_IMAGE' });
    assert.deepEqual([packageInvoice.productKind, addOnInvoice.productKind], ['PACKAGE', 'RECEIPT_IMAGE']);
    // Both slots at once, on different attempts: the add-on slot never borrows the package one (T-02).
    await client.billingAccount.update({ where: { id: row.id }, data: { activeAttemptId: packageAttempt.id, activeAddOnAttemptId: addOnAttempt.id } });
    const stored = await client.billingAccount.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual([stored.activeAttemptId, stored.activeAddOnAttemptId], [packageAttempt.id, addOnAttempt.id]);
    const index = await client.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes
      WHERE tablename = 'BillingInvoice' AND indexname = 'BillingInvoice_billingAccountId_productKind_periodEnd_idx'`;
    assert.equal(index.length, 1);
  });

  it('holds one add-on attempt in one account slot only', async () => {
    const first = await account(), second = await account(), addOn = await attempt(first.id, { productKind: 'CHAT_CREDIT' });
    await client.billingAccount.update({ where: { id: first.id }, data: { activeAddOnAttemptId: addOn.id } });
    await assert.rejects(client.billingAccount.update({ where: { id: second.id }, data: { activeAddOnAttemptId: addOn.id } }));
    await client.billingAccount.update({ where: { id: first.id }, data: { activeAddOnAttemptId: null } });
    await client.billingAccount.update({ where: { id: second.id }, data: { activeAddOnAttemptId: addOn.id } });
  });

  it('never lets a newer add-on invoice pass for the latest package invoice (all four readers)', async () => {
    const row = await account();
    const periodStart = new Date('2026-09-01T00:00:00.000Z'), periodEnd = new Date('2026-10-01T00:00:00.000Z'), paidAt = new Date('2026-12-01T00:00:00.000Z');
    const packageInvoice = await invoice(row.id, periodStart, periodEnd);
    // An add-on invoice starts and ends at paidAt (F-35) — here later than the package period, the worst case.
    await invoice(row.id, paidAt, paidAt, { productKind: 'CHAT_CREDIT' });
    await invoice(row.id, paidAt, paidAt, { productKind: 'RECEIPT_IMAGE' });
    const unfiltered = await client.billingInvoice.findFirst({ where: { billingAccountId: row.id }, orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }] });
    assert.notEqual(unfiltered?.productKind, 'PACKAGE', 'the fixture must be one the old query got wrong');
    // Status and the admin company view read the latest invoice; both notification anchors read the latest APPLIED one.
    assert.equal((await latestPackageInvoice(client, { billingAccountId: row.id }))?.id, packageInvoice.id);
    assert.equal((await latestPackageInvoice(client, { billingAccountId: row.id, applyStatus: 'APPLIED', appliedAt: { not: null } }))?.id, packageInvoice.id);
    assert.equal(await client.$transaction(async tx => (await latestPackageInvoice(tx, { billingAccountId: row.id }))?.id), packageInvoice.id);
    const addOnOnly = await account();
    await invoice(addOnOnly.id, paidAt, paidAt, { productKind: 'CHAT_CREDIT' });
    assert.equal(await latestPackageInvoice(client, { billingAccountId: addOnOnly.id }), null);
  });

  it('refuses an add-on snapshot at the reconciler dispatch points before any Stripe call', async () => {
    const row = await account(), calls: unknown[] = [];
    const stripe = { accountId: row.stripeAccountId, livemode: false, assertAccount: async () => undefined,
      request: async (...args: unknown[]) => { calls.push(args); throw new Error('no Stripe call expected'); },
      list: async (...args: unknown[]) => { calls.push(args); throw new Error('no Stripe call expected'); } };
    const reconciler = new BillingReconcilerService({ client } as PrismaService, {} as never, stripe as never, {} as never, {} as never);
    const addOn = await attempt(row.id, { productKind: 'CHAT_CREDIT', quoteSnapshot: { productKind: 'CHAT_CREDIT' } });
    const at = new Date('2026-09-29T03:00:00.000Z');
    const held = await invoice(row.id, at, at, { productKind: 'CHAT_CREDIT', sourceAttemptId: addOn.id, applyStatus: 'HELD', appliedAt: null });
    // A held add-on invoice is never retried through package apply (reconcileOriginalInvoice).
    await assert.rejects(reconciler.reconcileAccount(row.id, undefined, undefined, held.id), /billing\.addon_reconcile_unsupported/);
    // An add-on attempt in the package slot is a data error, never a one-time package payment.
    await client.billingAccount.update({ where: { id: row.id }, data: { activeAttemptId: addOn.id } });
    await assert.rejects(reconciler.reconcileAccount(row.id), /billing\.addon_reconcile_unsupported/);
    assert.deepEqual(calls, []);
    const released = await client.billingAccount.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual([released.leaseToken, released.leaseUntil], [null, null]);
  });
});
