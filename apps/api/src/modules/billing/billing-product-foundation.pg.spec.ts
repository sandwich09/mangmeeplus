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
import { appendPackageInterval, fullPackagePurchaseImpact, proratedPackagePrice } from './domain/billing-package';
import { BILLING_DRAFT_POLICY, billingOffer } from '@watchdog-bms/contracts';
import { upgradeHistory } from './application/billing-upgrade';
import { scheduleDealReturn } from './application/billing-package-request';

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

// Pure money checks live in this existing CI-registered spec; they do not need PostgreSQL.

it('MONEY-Q1 a purchase on 1 March at 03:00 Bangkok buys through 1 April at 03:00', () => {
  const paidAt = new Date('2025-02-28T20:00:00.000Z');
  const impact = fullPackagePurchaseImpact({ tier: 'STARTER_249', interval: 'month', verifiedPaidAt: paidAt, paidThrough: null, remainingPaidReceipts: 0 });
  assert.equal(impact.paidThrough.toISOString(), '2025-03-31T20:00:00.000Z');
});

it('MONEY-Q1 Bangkok month ends, leap years, yearly and repeated intervals keep their anniversary and clock', () => {
  const january = new Date('2024-01-30T20:12:34.567Z'); // 31 January 03:12 Bangkok
  const february = appendPackageInterval(january, 'month');
  assert.equal(february.toISOString(), '2024-02-28T20:12:34.567Z');
  assert.equal(appendPackageInterval(february, 'month', 31).toISOString(), '2024-03-30T20:12:34.567Z');
  const leap = new Date('2024-02-28T20:12:34.567Z');
  assert.equal(appendPackageInterval(leap, 'year').toISOString(), '2025-02-27T20:12:34.567Z');
  assert.equal(appendPackageInterval(leap, 'year', undefined, 4).toISOString(), '2028-02-28T20:12:34.567Z');
});

it('MONEY-Q1 5000 seeded service intervals and deal returns match an independent Bangkok calendar, including 31 January 03:00', async () => {
  let seed = 777;
  const pick = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * limit); };
  const format = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
  for (let i = 0; i < 5000; i++) {
    const year = 2020 + pick(30), month = pick(12), day = 1 + pick(new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    const start = i === 0 ? new Date('2026-01-30T20:00:00Z') : new Date(Date.UTC(year, month, day, pick(24) - 7, pick(60), pick(60), pick(1000)));
    const interval = pick(2) ? 'month' : 'year', count = 1 + pick(36);
    const parts = Object.fromEntries(format.formatToParts(start).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    const target = parts.year! * 12 + parts.month! - 1 + count * (interval === 'year' ? 12 : 1);
    const y = Math.floor(target / 12), m = target % 12, anchor = parts.day!;
    const d = Math.min(anchor, new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
    const expected = Date.UTC(y, m, d, parts.hour! - 7, parts.minute!, parts.second!, start.getUTCMilliseconds());
    const end = appendPackageInterval(start, interval, undefined, count);
    assert.equal(end.getTime(), expected, `${start.toISOString()} + ${count} ${interval}`);
    let chained = start;
    for (let n = 0; n < count; n++) chained = appendPackageInterval(chained, interval, anchor);
    assert.equal(chained.getTime(), expected);
    let returned: Date | undefined;
    await scheduleDealReturn({ packageChangeRequest: { updateMany: async ({ data }: any) => { returned = data.returnAt; } } } as any,
      { companyId: 'shop', periodStart: start, deal: { requestId: 'deal', cadence: interval, cycles: count } as any });
    assert.equal(returned?.getTime(), expected, `deal return ${start.toISOString()} + ${count} ${interval}`);
  }
});

function upgradeFixture(start: Date, end: Date) {
  const old = billingOffer('STARTER_249', 'month'), next = billingOffer('BASIC_499', 'month');
  const grant = { id: 'grant', kind: 'INITIAL', sourceKey: 'invoice', units: old.receiptAllowance, serviceStart: start, serviceEnd: end, availableAt: start, expiresAt: end, sourceHash: 'proof' };
  const invoice = { id: 'invoice', appliedAt: start, applyStatus: 'APPLIED', providerStatus: 'paid', paidSatang: old.priceSatang, totalSatang: old.priceSatang,
    refundedSatang: 0, disputed: false, evidenceHash: 'proof', periodStart: start, periodEnd: end, contractSnapshot: { quote: { offer: old }, policy: BILLING_DRAFT_POLICY } };
  return { next, db: { billingReceiptGrant: { findMany: async () => [grant] }, billingInvoice: { findMany: async () => [invoice] }, billingOperation: { findMany: async () => [] } } as any,
    account: { id: 'account', companyId: 'shop', paidThrough: end } as any };
}

it('MONEY-Q1 the 446-satang February upgrade has a specific refusal and keeps the 1000-satang minimum', async () => {
  const start = new Date('2026-01-31T17:00:00Z'), end = new Date('2026-02-28T17:00:00Z'), at = new Date('2026-02-28T05:00:00Z');
  const f = upgradeFixture(start, end);
  assert.equal(proratedPackagePrice(24900, 49900, start, end, at), 446);
  await assert.rejects(upgradeHistory(f.db, f.account, f.next, BILLING_DRAFT_POLICY, at.toISOString()), (e: any) => e.getResponse().code === 'BILLING_UPGRADE_BELOW_MINIMUM');
});

it('MONEY-Q1 3000 seeded upgrade amounts retain exact prices and the existing minimum', async () => {
  let seed = 12345;
  const pick = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * limit); };
  for (let i = 0; i < 3000; i++) {
    const start = new Date(Date.UTC(2024 + pick(5), pick(12), 1, -7)), end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 2, 1, -7));
    const duration = end.getTime() - start.getTime(), at = new Date(start.getTime() + pick(duration));
    const remaining = BigInt(end.getTime() - at.getTime()), denominator = BigInt(duration);
    const sameDay = Math.floor((at.getTime() + 25200000) / 86400000) === Math.floor((start.getTime() + 25200000) / 86400000);
    const expected = sameDay ? 25000 : Number((2n * 25000n * remaining + denominator) / (2n * denominator));
    const f = upgradeFixture(start, end), result = upgradeHistory(f.db, f.account, f.next, BILLING_DRAFT_POLICY, at.toISOString());
    if (expected < 1000) await assert.rejects(result, (e: any) => e.getResponse().code === 'BILLING_UPGRADE_BELOW_MINIMUM');
    else assert.equal((await result).amountSatang, expected);
  }
});


it('MONEY-Q1 999 satang is refused while 1000 and 1001 satang remain payable', async () => {
  const start = new Date('2026-01-31T17:00:00Z'), end = new Date('2026-02-28T17:00:00Z');
  for (const amount of [999, 1000, 1001]) {
    const f = upgradeFixture(start, end), at = new Date(end.getTime() - amount * (end.getTime() - start.getTime()) / 25000);
    const result = upgradeHistory(f.db, f.account, f.next, BILLING_DRAFT_POLICY, at.toISOString());
    if (amount < 1000) await assert.rejects(result, (e: any) => e.getResponse().code === 'BILLING_UPGRADE_BELOW_MINIMUM');
    else assert.equal((await result).amountSatang, amount);
  }
});
