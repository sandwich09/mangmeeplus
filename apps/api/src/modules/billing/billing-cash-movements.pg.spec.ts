/**
 * The executive report's money facts (executive spec §14.1–§14.2) against real PostgreSQL.
 *
 * What only a real database shows: the provider's balance movements are JSON inside
 * `BillingOperation` rows keyed by the scan JOB, so "once per provider transaction, the row read
 * last" and "dated by the provider's own time" are properties of the SQL, not of a mocked client.
 * The daily job is here too: its idempotency is the unique key of the table.
 *
 * Every row carries a Stripe account id made for this run, so the shared test database and the rows
 * other specs left in it are never read. The purchase-kind table at the bottom needs no database and
 * runs wherever this file runs.
 *
 * Run with:
 *   BILLING_CASH_MOVEMENTS_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     npx tsx --test src/modules/billing/billing-cash-movements.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import type { RequestContext } from '../auth/domain/models/request-context.model';
import { BillingAdminService } from './application/billing-admin.service';
import { BillingCashMovementsService, billingCoveredThrough, billingPurchaseKind } from './application/billing-cash-movements.service';
import { BillingConfigurationService } from './application/billing-configuration.service';
import { BillingSettlementService } from './application/billing-settlement.service';
import { configurationHash } from './domain/billing-policy';

const databaseUrl = process.env.BILLING_CASH_MOVEMENTS_TEST_DATABASE_URL;
const at = (iso: string) => new Date(iso);
const seconds = (iso: string) => Date.parse(iso) / 1000;
/** September 2026 in Asia/Bangkok, as the UTC instants the caller computes. */
const SEPTEMBER = { start: at('2026-08-31T17:00:00.000Z'), end: at('2026-09-30T17:00:00.000Z') };
const AUGUST = { start: at('2026-07-31T17:00:00.000Z'), end: SEPTEMBER.start };

describe('billing cash movements on real PostgreSQL', { skip: !databaseUrl }, () => {
  let client: PrismaClient;
  const account = `acct_cash${randomUUID().replaceAll('-', '')}`;
  const tag = randomUUID().slice(0, 8);
  const company = `cash-company-${tag}`;
  let live: BillingCashMovementsService;
  let observedAt = Date.parse('2026-10-01T00:00:00.000Z');

  const reader = (stripeAccountId: string, billingMode: 'live' | 'test' | 'disabled' = 'live') =>
    new BillingCashMovementsService({ client } as never, { billingMode, stripeAccountId } as never);

  async function scanJob(input: { since: string; until: string; state?: string; livemode?: boolean; stripeAccountId?: string }) {
    const proposedJson = { since: seconds(input.since), until: seconds(input.until), membershipId: 'm', actorCompanyId: 'c' };
    return client.billingOperation.create({ data: { stripeAccountId: input.stripeAccountId ?? account, livemode: input.livemode ?? true,
      type: 'SCAN_PROVIDER_BALANCE', state: input.state ?? 'SUCCEEDED', proposedJson, sourceVersion: 0, reason: 'spec',
      initiatorUserId: 'spec', requestHash: 'spec', expiresAt: at('2030-01-01T00:00:00.000Z'), resultJson: {} } });
  }
  /** One row the scan writes per movement it read; `observedAt` moves forward, so a later call is a later read. */
  async function finding(jobId: string, movement: { id: string; type: string; amount: number; fee?: number; created: string; currency?: string },
    observation: Record<string, unknown> = {}, scope: { livemode?: boolean; stripeAccountId?: string } = {}) {
    observedAt += 1000;
    const fee = movement.fee ?? 0;
    await client.billingOperation.create({ data: { stripeAccountId: scope.stripeAccountId ?? account, livemode: scope.livemode ?? true,
      type: 'OBSERVE_PROVIDER_BALANCE', referenceId: jobId, state: 'SUCCEEDED', sourceVersion: 0, reason: 'spec', initiatorUserId: 'spec',
      requestHash: 'spec', idempotencyKey: `settlement:${jobId}:${movement.id}`, expiresAt: at('2030-01-01T00:00:00.000Z'), observedAt: new Date(observedAt),
      proposedJson: { movement: { id: movement.id, sourceId: null, type: movement.type, category: movement.type, currency: movement.currency ?? 'thb',
        amount: movement.amount, fee, net: movement.amount - fee, status: 'available', created: seconds(movement.created),
        availableOn: seconds(movement.created), balanceType: 'payments' },
        classification: 'MANUAL', refundState: null, taxSatang: null, payout: null, invoiceId: null, companyId: null, accountId: null,
        localHash: null, disputed: null, ...observation } } });
  }
  async function invoice(input: { sourceAttemptId?: string | null; subscriptionId?: string | null; productKind?: string; contractKind?: string }) {
    const row = await client.billingInvoice.create({ data: { billingAccountId: `ba-${tag}`, providerInvoiceId: `in_${randomUUID()}`,
      sourceAttemptId: input.sourceAttemptId ?? null, subscriptionId: input.subscriptionId ?? null, offerSnapshot: {},
      contractSnapshot: { quote: { purchase: { kind: input.contractKind ?? 'INITIAL' } } }, productKind: input.productKind ?? 'PACKAGE',
      policyRevisionId: 'p', currency: 'THB', totalSatang: 149_000, paidSatang: 149_000, taxSatang: 9_748, periodStart: SEPTEMBER.start,
      periodEnd: SEPTEMBER.end, providerStatus: 'paid', evidenceHash: 'h' } });
    return row.id;
  }
  async function attempt(kind: string, extra: Record<string, unknown> = {}) {
    const row = await client.billingAttempt.create({ data: { billingAccountId: `ba-${tag}`, initiatingUserId: 'spec', quoteId: randomUUID(),
      channel: 'web', idempotencyKey: randomUUID(), requestHash: 'h', quoteSnapshot: { quote: { purchase: { kind } }, ...extra },
      policyRevisionId: 'p', consentRevision: 'c', consentAt: new Date() } });
    return row.id;
  }
  const matched = (invoiceId: string, taxSatang: number | null = null) =>
    ({ classification: 'MATCHED', invoiceId, companyId: company, accountId: `ba-${tag}`, taxSatang });
  const only = (rows: Awaited<ReturnType<BillingCashMovementsService['movements']>>, id: string) => {
    const found = rows.filter((row) => row.providerTransactionId === id);
    assert.equal(found.length, 1, `${id} must come back exactly once`);
    return found[0]!;
  };

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
    assert.ok(url.pathname === '/watchdog_bms' || url.pathname.endsWith('_ci'), `refusing to write to ${url.pathname}: only a disposable test database is allowed`);
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    live = reader(account);
  });
  after(async () => { await client?.$disconnect(); });

  it('dates a movement by the provider time, on the Bangkok month boundary to the second', async () => {
    const job = (await scanJob({ since: '2026-08-01T00:00:00Z', until: '2026-10-02T00:00:00Z' })).id;
    const first = await invoice({ sourceAttemptId: await attempt('INITIAL') });
    // The spec's own example: paid 149,000 on 31 Aug 23:59 Bangkok, 49,900 refunded on 1 Sep 00:00 Bangkok.
    await finding(job, { id: `txn_${tag}aug`, type: 'charge', amount: 149_000, fee: 5_513, created: '2026-08-31T16:59:59Z' }, matched(first, 9_748));
    await finding(job, { id: `txn_${tag}refund`, type: 'refund', amount: -49_900, created: '2026-08-31T17:00:00Z' }, { ...matched(first), refundState: 'succeeded' });
    await finding(job, { id: `txn_${tag}sep0`, type: 'charge', amount: 24_900, created: '2026-08-31T17:00:00Z' }, matched(first, 1_629));
    await finding(job, { id: `txn_${tag}utc0659`, type: 'charge', amount: 100, created: '2026-09-01T06:59:00Z' }, matched(first, 0));
    await finding(job, { id: `txn_${tag}utc0700`, type: 'charge', amount: 200, created: '2026-09-01T07:00:00Z' }, matched(first, 0));
    await finding(job, { id: `txn_${tag}last`, type: 'charge', amount: 300, created: '2026-09-30T16:59:59Z' }, matched(first, 0));
    await finding(job, { id: `txn_${tag}oct`, type: 'charge', amount: 400, created: '2026-09-30T17:00:00Z' }, matched(first, 0));

    const august = await live.movements(AUGUST), september = await live.movements(SEPTEMBER);
    assert.deepEqual(august.map((row) => row.providerTransactionId), [`txn_${tag}aug`]);
    const paid = only(august, `txn_${tag}aug`);
    assert.deepEqual({ kind: paid.kind, tie: paid.tie, amount: paid.amountSatang, fee: paid.feeSatang, net: paid.netSatang, tax: paid.taxSatang,
      company: paid.companyId, invoice: paid.invoiceId, at: paid.occurredAt.toISOString(), purchase: paid.purchaseKind, product: paid.productKind },
    { kind: 'RECEIPT', tie: 'COMPANY', amount: 149_000, fee: 5_513, net: 143_487, tax: 9_748, company, invoice: first,
      at: '2026-08-31T16:59:59.000Z', purchase: 'FIRST_PURCHASE', product: 'PACKAGE' });

    assert.deepEqual(september.map((row) => row.providerTransactionId).sort(),
      [`txn_${tag}last`, `txn_${tag}refund`, `txn_${tag}sep0`, `txn_${tag}utc0659`, `txn_${tag}utc0700`].sort());
    // A refund is its own movement in the month it was refunded: positive amount, the company's, no tax.
    const refund = only(september, `txn_${tag}refund`);
    assert.deepEqual({ kind: refund.kind, tie: refund.tie, amount: refund.amountSatang, net: refund.netSatang, tax: refund.taxSatang, company: refund.companyId },
      { kind: 'REFUND', tie: 'COMPANY', amount: 49_900, net: -49_900, tax: null, company });
    // August keeps what came in: receipts 149,000 and no refund, exactly as the spec example says.
    assert.equal(august.filter((row) => row.kind === 'REFUND').length, 0);

    // A range given in milliseconds still cuts at the right second on both ends.
    const inner = await live.movements({ start: new Date(SEPTEMBER.start.getTime() - 1), end: new Date(SEPTEMBER.end.getTime() - 1) });
    assert.deepEqual(inner.map((row) => row.providerTransactionId).sort(), september.map((row) => row.providerTransactionId).sort());
    assert.equal((await live.movements({ start: new Date(SEPTEMBER.start.getTime() + 1), end: SEPTEMBER.end }))
      .some((row) => row.providerTransactionId === `txn_${tag}sep0`), false);
  });

  it('counts a movement once when two overlapping jobs read it, by the row read last', async () => {
    const earlier = (await scanJob({ since: '2026-10-05T00:00:00Z', until: '2026-10-07T00:00:00Z' })).id;
    const later = (await scanJob({ since: '2026-10-06T00:00:00Z', until: '2026-10-08T00:00:00Z' })).id;
    const paid = await invoice({ subscriptionId: 'sub_spec' });
    const movement = { id: `txn_${tag}twice`, type: 'charge', amount: 53_393, fee: 2_000, created: '2026-10-06T03:00:00Z' };
    // First read: the local invoice had not caught up, so the scan left it for a check. Second read: matched.
    await finding(earlier, movement, { classification: 'DIFFERENT', invoiceId: paid, companyId: company });
    await finding(later, movement, matched(paid, 3_493));
    const again = { id: `txn_${tag}worse`, type: 'charge', amount: 700, created: '2026-10-06T04:00:00Z' };
    await finding(earlier, again, matched(paid, 46));
    await finding(later, again, { classification: 'DIFFERENT', invoiceId: paid, companyId: company });

    const rows = await live.movements({ start: at('2026-10-05T17:00:00Z'), end: at('2026-10-06T17:00:00Z') });
    assert.equal(rows.length, 2);
    const twice = only(rows, movement.id);
    assert.deepEqual({ tie: twice.tie, company: twice.companyId, amount: twice.amountSatang, tax: twice.taxSatang, purchase: twice.purchaseKind },
      { tie: 'COMPANY', company, amount: 53_393, tax: 3_493, purchase: 'RENEWAL' });
    // The latest read wins in the other direction too: a movement put back under review is no longer the company's.
    const worse = only(rows, again.id);
    assert.deepEqual({ tie: worse.tie, company: worse.companyId, invoice: worse.invoiceId, tax: worse.taxSatang },
      { tie: 'UNTIED', company: null, invoice: null, tax: null });
  });

  it('keeps payouts and unsuccessful refunds out of every total, and unmatched money untied', async () => {
    const job = (await scanJob({ since: '2026-11-01T00:00:00Z', until: '2026-11-03T00:00:00Z' })).id;
    const day = { start: at('2026-11-01T17:00:00Z'), end: at('2026-11-02T17:00:00Z') };
    const paid = await invoice({ sourceAttemptId: await attempt('SCHEDULED_CHANGE') });
    await finding(job, { id: `txn_${tag}payout`, type: 'payout', amount: -900_000, created: '2026-11-02T01:00:00Z' }, { classification: 'MATCHED' });
    await finding(job, { id: `txn_${tag}missing`, type: 'charge', amount: 24_900, fee: 900, created: '2026-11-02T02:00:00Z' }, { classification: 'LOCAL_MISSING' });
    await finding(job, { id: `txn_${tag}pending`, type: 'refund', amount: -24_900, created: '2026-11-02T03:00:00Z' },
      { classification: 'MANUAL', refundState: 'pending', invoiceId: paid, companyId: company });
    await finding(job, { id: `txn_${tag}failed`, type: 'refund', amount: -100, created: '2026-11-02T03:30:00Z' }, { classification: 'LOCAL_MISSING', refundState: 'failed' });
    await finding(job, { id: `txn_${tag}lostrefund`, type: 'refund', amount: -5_000, created: '2026-11-02T04:00:00Z' }, { classification: 'LOCAL_MISSING', refundState: 'succeeded' });
    await finding(job, { id: `txn_${tag}adjust`, type: 'adjustment', amount: -1_500, created: '2026-11-02T05:00:00Z' });
    await finding(job, { id: `txn_${tag}usd`, type: 'charge', amount: 999, currency: 'usd', created: '2026-11-02T06:00:00Z' });
    await finding(job, { id: `txn_${tag}change`, type: 'charge', amount: 49_900, created: '2026-11-02T07:00:00Z' }, matched(paid, 3_264));

    const rows = await live.movements(day);
    const shape = (id: string) => { const row = only(rows, `txn_${tag}${id}`); return [row.kind, row.tie, row.amountSatang, row.companyId, row.purchaseKind].join(' '); };
    assert.equal(shape('payout'), 'PAYOUT EXCLUDED -900000  UNKNOWN');
    assert.equal(shape('missing'), 'RECEIPT UNTIED 24900  UNKNOWN');
    // The pending refund still names its invoice's kind: a paid-ahead SCHEDULED_CHANGE is RENEWAL (owner 2026-10-03).
    assert.equal(shape('pending'), 'REFUND EXCLUDED 24900  RENEWAL');
    assert.equal(shape('failed'), 'REFUND EXCLUDED 100  UNKNOWN');
    assert.equal(shape('lostrefund'), 'REFUND UNTIED 5000  UNKNOWN');
    assert.equal(shape('adjust'), 'OTHER UNTIED -1500  UNKNOWN');
    assert.equal(only(rows, `txn_${tag}usd`).currency, 'USD');
    assert.equal(only(rows, `txn_${tag}usd`).tie, 'UNTIED');
    // Owner 2026-10-03: a paid-ahead tier/interval change is a renewal.
    assert.equal(shape('change'), `RECEIPT COMPANY 49900 ${company} RENEWAL`);
    // What a caller adds up for companies is exactly the COMPANY rows.
    assert.equal(rows.filter((row) => row.tie === 'COMPANY').reduce((sum, row) => sum + row.amountSatang, 0), 49_900);
  });

  for (const [name, quoteKind, priorEnd, expected, conversion] of [
    ['scheduled change', 'SCHEDULED_CHANGE', null, 'RENEWAL', false],
    ['live conversion', 'INITIAL', '2026-09-20T03:00:00Z', 'RENEWAL', true],
    ['ended conversion', 'INITIAL', '2026-09-01T03:00:00Z', 'RETURN', true],
    ['live deal without conversion', 'INITIAL', '2026-09-20T03:00:00Z', 'RENEWAL', false],
    ['ended deal without conversion', 'INITIAL', '2026-09-01T03:00:00Z', 'RETURN', false],
    ['end-boundary conversion', 'INITIAL', '2026-09-15T03:00:00Z', 'RETURN', true],
    ['advance deal', 'ADVANCE_DEAL', '2026-09-20T03:00:00Z', 'RENEWAL', false],
    ['late advance deal', 'ADVANCE_DEAL', '2026-09-01T03:00:00Z', 'RETURN', false],
    ['live one-time deal', 'REPEAT', '2026-09-20T03:00:00Z', 'RENEWAL', false],
    ['ended one-time deal', 'RESTART', '2026-09-01T03:00:00Z', 'RETURN', false],
    ['never-paid deal', 'INITIAL', null, 'FIRST_PURCHASE', false],
    ['ordinary first purchase', 'INITIAL', null, 'FIRST_PURCHASE', false],
    ['subscription cycle', null, null, 'RENEWAL', false],
    ['ordinary restart', 'RESTART', '2026-09-01T03:00:00Z', 'RETURN', false],
  ] as const) {
    it(`uses payment-time history for ${name} in cash and company purchases, once per movement`, async () => {
      const companyId = `kind-${randomUUID()}`;
      await client.company.create({ data: { id: companyId, name: 'spec' } });
      const b = await client.billingAccount.create({ data: { companyId, stripeAccountId: account, livemode: true,
        // Today's package ends much later; it must not change the old purchase kind.
        paidThrough: at('2027-01-01T00:00:00Z') } });
      const paidAt = at('2026-09-15T03:00:00Z'), appliedAt = at('2026-10-05T03:00:00Z');
      const makeInvoice = (data: Record<string, unknown> = {}) => client.billingInvoice.create({ data: {
        billingAccountId: b.id, providerInvoiceId: `in_${randomUUID()}`, offerSnapshot: { offerKey: 'BASIC' },
        policyRevisionId: 'p', currency: 'THB', totalSatang: 10000, paidSatang: 10000, taxSatang: 0,
        periodStart: at('2026-08-01T00:00:00Z'), periodEnd: at('2026-09-01T03:00:00Z'),
        providerStatus: 'paid', evidenceHash: 'h', applyStatus: 'APPLIED', appliedAt: at('2026-08-01T00:00:00Z'), ...data } });
      if (priorEnd) await makeInvoice({ periodEnd: at(priorEnd) });
      // None of these proves a live paid package at this payment, even on a never-paid shop.
      await makeInvoice({ productKind: 'CHAT_CREDIT', periodEnd: at('2027-01-01T00:00:00Z') });
      await makeInvoice({ paidSatang: 0, periodEnd: at('2027-01-01T00:00:00Z') });
      await makeInvoice({ applyStatus: 'HELD', appliedAt: null, periodEnd: at('2027-01-01T00:00:00Z') });
      await makeInvoice({ appliedAt: at('2026-09-16T00:00:00Z'), periodEnd: at('2027-01-01T00:00:00Z') });
      const otherMode = await client.billingAccount.create({ data: { companyId, stripeAccountId: account, livemode: false } });
      await makeInvoice({ billingAccountId: otherMode.id, periodEnd: at('2027-01-01T00:00:00Z') });
      const isDeal = !['scheduled change', 'ordinary first purchase', 'subscription cycle', 'ordinary restart'].includes(name);
      const dealId = `deal-${randomUUID()}`;
      const a = quoteKind ? await client.billingAttempt.create({ data: { billingAccountId: b.id, initiatingUserId: 'spec',
        quoteId: randomUUID(), channel: 'web', idempotencyKey: randomUUID(), requestHash: 'h', policyRevisionId: 'p',
        consentRevision: 'c', consentAt: paidAt, quoteSnapshot: { quote: { purchase: { kind: quoteKind } },
          ...(isDeal ? { deal: { requestId: dealId } } : {}),
          ...(conversion ? { subscriptionConversion: { subscriptionId: 'old-sub', paidThrough: priorEnd } } : {}) } } }) : null;
      const current = await makeInvoice({ sourceAttemptId: a?.id ?? null, subscriptionId: quoteKind ? null : 'cycle-sub',
        periodStart: appliedAt, periodEnd: at('2026-11-05T03:00:00Z'), appliedAt });
      if (isDeal) await client.packageChangeRequest.create({ data: { id: dealId, companyId, requestedByUserId: 'spec',
        requestedTierKey: 'BASIC', kind: 'SALES_DEAL', status: 'APPLIED', paymentRef: current.id, verifiedAt: paidAt } });
      // History works before any balance scan: a paid-ahead deal's verifiedAt precedes its application.
      const purchases = await live.companyPackagePurchases(companyId);
      assert.equal(purchases.filter(p => p.appliedAt.getTime() === appliedAt.getTime()).length, 1);
      assert.equal(purchases.find(p => p.appliedAt.getTime() === appliedAt.getTime())?.purchaseKind, expected);
      const job = (await scanJob({ since: '2026-09-01T00:00:00Z', until: '2026-10-01T00:00:00Z' })).id;
      const id = `txn_${randomUUID()}`, refundId = `txn_${randomUUID()}`;
      const observation = { classification: 'MATCHED', invoiceId: current.id, companyId, accountId: b.id, taxSatang: 0 };
      await finding(job, { id, type: 'charge', amount: 10000, created: paidAt.toISOString() }, observation);
      const reread = (await scanJob({ since: '2026-09-01T00:00:00Z', until: '2026-10-01T00:00:00Z' })).id;
      await finding(reread, { id, type: 'charge', amount: 10000, created: paidAt.toISOString() }, observation);
      await finding(job, { id: refundId, type: 'refund', amount: -1000, created: '2026-09-29T03:00:00Z' }, { ...observation, refundState: 'succeeded' });
      const rows = (await live.movements(SEPTEMBER)).filter(r => r.invoiceId === current.id);
      assert.deepEqual(rows.map(r => r.purchaseKind), [expected, expected]);
      assert.equal(rows.reduce((sum, r) => sum + (r.kind === 'REFUND' ? -r.amountSatang : r.amountSatang), 0), 9000);
      if (isDeal) {
        // A held/deleted deal source can lack verifiedAt: both readers use the original charge, never the refund's date.
        await client.packageChangeRequest.update({ where: { id: dealId }, data: { verifiedAt: null } });
        assert.equal((await live.companyPackagePurchases(companyId)).find(p => p.appliedAt.getTime() === appliedAt.getTime())?.purchaseKind, expected);
        assert.deepEqual((await live.movements(SEPTEMBER)).filter(r => r.invoiceId === current.id).map(r => r.purchaseKind), [expected, expected]);
      }
    });
  }

  it('never mixes TEST with LIVE, or one provider account with another', async () => {
    const other = `acct_other${randomUUID().replaceAll('-', '')}`;
    const window = { since: '2026-12-01T00:00:00Z', until: '2026-12-03T00:00:00Z' };
    const day = { start: at('2026-12-01T17:00:00Z'), end: at('2026-12-02T17:00:00Z') };
    const liveJob = (await scanJob(window)).id, testJob = (await scanJob({ ...window, livemode: false })).id;
    const otherJob = (await scanJob({ ...window, stripeAccountId: other })).id;
    const id = `txn_${tag}mode`;
    await finding(liveJob, { id, type: 'charge', amount: 111, created: '2026-12-02T01:00:00Z' });
    await finding(testJob, { id, type: 'charge', amount: 222, created: '2026-12-02T01:00:00Z' }, {}, { livemode: false });
    await finding(otherJob, { id, type: 'charge', amount: 333, created: '2026-12-02T01:00:00Z' }, {}, { stripeAccountId: other });

    assert.deepEqual((await live.movements(day)).map((row) => row.amountSatang), [111]);
    assert.deepEqual((await reader(account, 'test').movements(day)).map((row) => row.amountSatang), [222]);
    assert.deepEqual((await reader(other).movements(day)).map((row) => row.amountSatang), [333]);
    assert.deepEqual(await reader(account, 'disabled').movements(day), []);
    assert.deepEqual(await reader(account, 'disabled').coverage(), { ranges: [], dataThrough: null, since: null });
  });

  it('refuses an amount that is not a safe integer instead of adding it up', async () => {
    const scope = `acct_unsafe${randomUUID().replaceAll('-', '')}`;
    const job = (await scanJob({ since: '2026-12-01T00:00:00Z', until: '2026-12-03T00:00:00Z', stripeAccountId: scope })).id;
    await finding(job, { id: `txn_${tag}unsafe`, type: 'charge', amount: 2 ** 53, created: '2026-12-02T01:00:00Z' }, {}, { stripeAccountId: scope });
    await assert.rejects(reader(scope).movements({ start: at('2026-12-01T17:00:00Z'), end: at('2026-12-02T17:00:00Z') }), /billing\.cash_movement_invalid/);
  });

  it('reports which time successful scans cover, so a month not read whole is known', async () => {
    const scope = `acct_cover${randomUUID().replaceAll('-', '')}`;
    const job = (since: string, until: string, state = 'SUCCEEDED', livemode = true) => scanJob({ since, until, state, livemode, stripeAccountId: scope });
    await job('2026-09-14T17:00:00Z', '2026-09-30T17:00:00Z');
    await job('2026-08-31T17:00:00Z', '2026-09-15T17:00:00Z');
    await job('2026-10-02T17:00:00Z', '2026-10-03T17:00:00Z');
    await job('2026-09-30T17:00:00Z', '2026-10-02T17:00:00Z', 'QUEUED');
    await job('2026-09-30T17:00:00Z', '2026-10-02T17:00:00Z', 'BLOCKED');
    await job('2026-09-30T17:00:00Z', '2026-10-02T17:00:00Z', 'SUCCEEDED', false);

    const coverage = await reader(scope).coverage();
    assert.deepEqual(coverage.ranges.map((range) => [range.start.toISOString(), range.end.toISOString()]), [
      ['2026-08-31T17:00:00.000Z', '2026-09-30T17:00:00.000Z'], ['2026-10-02T17:00:00.000Z', '2026-10-03T17:00:00.000Z']]);
    assert.equal(coverage.dataThrough?.toISOString(), '2026-10-03T17:00:00.000Z');
    // September was read whole; October starts in the gap, so its money is BILLING_SCAN_NOT_COMPLETE.
    assert.equal(billingCoveredThrough(coverage.ranges, SEPTEMBER.start)?.getTime(), SEPTEMBER.end.getTime());
    assert.equal(billingCoveredThrough(coverage.ranges, SEPTEMBER.end), null);
    assert.equal(billingCoveredThrough(coverage.ranges, AUGUST.start), null);
    // No billing account in this mode yet: no online payment can exist, so there is no start to cover from.
    assert.equal(coverage.since, null);
  });

  it('says per company whether a paid invoice exists in this mode, and what billing makes of a company without one', async () => {
    const scope = `acct_paid${randomUUID().replaceAll('-', '')}`;
    const ids = { paid: `cash-paid-${tag}`, refunded: `cash-refunded-${tag}`, trial: `cash-trial-${tag}`, never: `cash-never-${tag}`,
      manual: `cash-manual-${tag}`, testOnly: `cash-testonly-${tag}`, bare: `cash-bare-${tag}` };
    for (const id of Object.values(ids)) await client.company.create({ data: { id, name: 'spec' } });
    const term = (companyId: string, tierKey: string, days: number, renewCount = 0) => client.companyPlanTerm.create({ data: { companyId, tierKey, branchLimit: 1,
      employeeLimit: 2, monthlySlipLimit: 30, termStartAt: at('2026-09-01T00:00:00Z'), termEndsAt: new Date(Date.parse('2026-09-01T00:00:00Z') + days * 86_400_000), renewCount } });
    const billingAccount = (companyId: string, livemode = true, createdAt = at('2026-09-14T03:00:00Z')) =>
      client.billingAccount.create({ data: { companyId, stripeAccountId: scope, livemode, createdAt } });
    const paidInvoice = (billingAccountId: string, paidSatang: number, refundedSatang = 0, providerStatus = 'paid') => client.billingInvoice.create({ data: {
      billingAccountId, providerInvoiceId: `in_${randomUUID()}`, offerSnapshot: {}, policyRevisionId: 'p', currency: 'THB', totalSatang: paidSatang, paidSatang, refundedSatang,
      periodStart: SEPTEMBER.start, periodEnd: SEPTEMBER.end, providerStatus, evidenceHash: 'h' } });

    await term(ids.paid, 'STARTER_249', 30);
    const paid = await billingAccount(ids.paid);
    await paidInvoice(paid.id, 24_900); await paidInvoice(paid.id, 24_900);
    await term(ids.refunded, 'STARTER_249', 30);
    const refunded = await billingAccount(ids.refunded, true, at('2026-09-20T00:00:00Z'));
    await paidInvoice(refunded.id, 24_900, 24_900);
    await paidInvoice(refunded.id, 99_900, 0, 'open');
    await term(ids.trial, 'FREE_TRIAL_15', 30);
    await term(ids.never, 'STARTER_249', 0);
    await term(ids.manual, 'PRO_999', 365, 1);
    // Paid in TEST only: in LIVE this company has no account and no invoice.
    await term(ids.testOnly, 'STARTER_249', 30);
    await paidInvoice((await billingAccount(ids.testOnly, false, at('2026-08-01T00:00:00Z'))).id, 24_900);
    // An account that started a checkout and never paid.
    await billingAccount(ids.bare, true, at('2026-09-25T00:00:00Z'));

    const payments = await reader(scope).companyPayments();
    assert.deepEqual(payments.get(ids.paid), { paidInvoice: true, invoicePaidSatang: 49_800, invoiceRefundedSatang: 0, sourceWithoutInvoice: 'ADMIN_MANUAL' });
    assert.deepEqual(payments.get(ids.refunded), { paidInvoice: true, invoicePaidSatang: 24_900, invoiceRefundedSatang: 24_900, sourceWithoutInvoice: 'ADMIN_MANUAL' });
    assert.deepEqual(payments.get(ids.trial), { paidInvoice: false, invoicePaidSatang: 0, invoiceRefundedSatang: 0, sourceWithoutInvoice: 'TRIAL' });
    assert.deepEqual(payments.get(ids.never), { paidInvoice: false, invoicePaidSatang: 0, invoiceRefundedSatang: 0, sourceWithoutInvoice: 'ADMIN_MANUAL' });
    assert.deepEqual(payments.get(ids.manual), { paidInvoice: false, invoicePaidSatang: 0, invoiceRefundedSatang: 0, sourceWithoutInvoice: 'ADMIN_MANUAL' });
    assert.deepEqual(payments.get(ids.testOnly), { paidInvoice: false, invoicePaidSatang: 0, invoiceRefundedSatang: 0, sourceWithoutInvoice: 'ADMIN_MANUAL' });
    assert.deepEqual(payments.get(ids.bare), { paidInvoice: false, invoicePaidSatang: 0, invoiceRefundedSatang: 0, sourceWithoutInvoice: 'NO_TERM' });
    assert.equal((await reader(scope, 'test').companyPayments()).get(ids.testOnly)?.paidInvoice, true);
    // The first billing account of the mode: nothing was paid online before it.
    assert.equal((await reader(scope).coverage()).since?.toISOString(), '2026-09-14T03:00:00.000Z');
    assert.equal((await reader(scope, 'test').coverage()).since?.toISOString(), '2026-08-01T00:00:00.000Z');
  });

  describe('the daily balance scan of the previous Bangkok day', () => {
    const scope = `acct_daily${randomUUID().replaceAll('-', '')}`;
    const stripe = { enabled: true, accountId: scope, livemode: true };
    const owner = `daily-owner-${tag}`, platform = `daily-platform-${tag}`, membership = `daily-membership-${tag}`;
    const DAY = 86400;
    const today = () => Math.floor((Date.now() / 1000 + 7 * 3600) / DAY) * DAY - 7 * 3600;
    let settlement: BillingSettlementService;
    const jobs = () => client.billingOperation.findMany({ where: { stripeAccountId: scope, type: 'SCAN_PROVIDER_BALANCE' }, orderBy: { createdAt: 'asc' } });
    async function publish(enabled: boolean, sourceVersion: number, intervalHours = 24) {
      return client.billingOperation.create({ data: { stripeAccountId: scope, livemode: true, type: 'CONFIGURE_PROVIDER_SCANS', state: 'SUCCEEDED',
        sourceVersion, reason: 'spec', initiatorUserId: owner, requestHash: 'spec', expiresAt: at('2030-01-01T00:00:00.000Z'), observedAt: new Date(),
        proposedJson: { enabled, intervalHours, initialLookbackHours: 48, membershipId: membership, actorCompanyId: platform } } });
    }

    before(async () => {
      settlement = new BillingSettlementService({ client } as never, stripe as never,
        new BillingAdminService({ client } as never, { stripe } as never), {} as never);
      await client.company.create({ data: { id: platform, name: 'Platform' } });
      await client.user.create({ data: { id: owner, displayName: 'Owner' } });
      const role = await client.role.upsert({ where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } },
        update: { isSystem: true, status: 'ACTIVE' }, create: { scopeKey: 'system', key: 'SYSTEM_ADMIN', name: 'System Admin', isSystem: true } });
      for (const key of ['system.billing.read', 'system.billing.financial.read', 'system.billing.reconcile.run']) {
        const permission = await client.permission.upsert({ where: { key }, update: {}, create: { key, description: key } });
        await client.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {},
          create: { roleId: role.id, permissionId: permission.id } });
      }
      await client.companyMembership.create({ data: { id: membership, companyId: platform, userId: owner, roles: { create: { roleId: role.id } } } });
    });

    it('queues nothing until the provider-scan schedule is published, valid and enabled', async () => {
      await settlement.scheduleDaily();
      await publish(false, 0);
      await settlement.scheduleDaily();
      // An enabled schedule whose stored settings are not valid schedules nothing, exactly as for the event scans.
      await publish(true, 1, 0);
      await settlement.scheduleDaily();
      assert.equal((await jobs()).length, 0);
    });

    it('queues yesterday once, as the schedule owner, however often the worker asks', async () => {
      const publication = await publish(true, 2);
      // Three workers ask at the same moment, then one asks again.
      await Promise.all([settlement.scheduleDaily(), settlement.scheduleDaily(), settlement.scheduleDaily()]);
      await settlement.scheduleDaily();
      const rows = await jobs();
      assert.equal(rows.length, 1);
      const row = rows[0]!, window = row.proposedJson as { since: number; until: number; membershipId: string; actorCompanyId: string; scheduleId: string };
      assert.equal(window.until, today());
      assert.equal(window.since, today() - DAY);
      assert.deepEqual({ state: row.state, key: row.idempotencyKey, initiator: row.initiatorUserId, membership: window.membershipId, company: window.actorCompanyId, schedule: window.scheduleId },
        { state: 'QUEUED', key: `scheduled-settlement:${today()}`, initiator: owner, membership, company: platform, schedule: publication.id });
      // The same hash recipe as a job an admin creates, or the drain's `actor()` check would refuse to run it.
      assert.equal(row.requestHash, configurationHash(['SCAN_PROVIDER_BALANCE', window, row.reason, owner]));
      const audit = await client.auditLog.findMany({ where: { targetId: row.id, action: 'billing.settlement.scheduled' } });
      assert.deepEqual(audit.map((entry) => [entry.actorType, entry.actorUserId, entry.companyId]), [['SERVICE', null, null]]);
    });

    // Not new behaviour: the one-time back-read uses this existing command, so its two limits are pinned here.
    it('lets an admin read back a window of at most 31 days, one recorded job per window', async () => {
      const admin = new BillingAdminService({ client } as never, { stripe } as never);
      const command = new BillingSettlementService({ client } as never, stripe as never, admin,
        new BillingConfigurationService({ client } as never, admin, { stripe } as never));
      const context: RequestContext = { requestId: randomUUID(), authSubject: owner, authProvider: 'watchdog', userId: owner, membershipId: membership, companyId: platform,
        roles: ['SYSTEM_ADMIN'], scopes: {}, permissions: ['system.billing.read', 'system.billing.financial.read', 'system.billing.reconcile.run'] };
      const reason = 'อ่านยอดย้อนหลังครั้งแรก';
      await assert.rejects(command.create(context, { windowStart: '2026-01-01T00:00:00Z', windowEnd: '2026-02-01T00:00:01Z', reason }, randomUUID()),
        (error: { getStatus?: () => number }) => error.getStatus?.() === 400);
      const key = randomUUID();
      const run = await command.create(context, { windowStart: '2026-01-01T00:00:00Z', windowEnd: '2026-02-01T00:00:00Z', reason }, key);
      assert.deepEqual({ state: run.state, mode: run.mode, start: run.windowStart, end: run.windowEnd, reason: run.reason },
        { state: 'QUEUED', mode: 'LIVE', start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z', reason });
      // The same Idempotency-Key is the same job; the job and who asked for it are on record.
      assert.equal((await command.create(context, { windowStart: '2026-01-01T00:00:00Z', windowEnd: '2026-02-01T00:00:00Z', reason }, key)).id, run.id);
      const audit = await client.auditLog.findMany({ where: { targetId: run.id, action: 'billing.settlement.created' } });
      assert.deepEqual(audit.map((entry) => entry.actorUserId), [owner]);
    });

    it('reads the days the worker missed in the next job, and stops when the owner loses the permission', async () => {
      const gap = `acct_gap${randomUUID().replaceAll('-', '')}`;
      const gapStripe = { enabled: true, accountId: gap, livemode: true };
      const service = new BillingSettlementService({ client } as never, gapStripe as never,
        new BillingAdminService({ client } as never, { stripe: gapStripe } as never), {} as never);
      await client.billingOperation.create({ data: { stripeAccountId: gap, livemode: true, type: 'CONFIGURE_PROVIDER_SCANS', state: 'SUCCEEDED', sourceVersion: 0,
        reason: 'spec', initiatorUserId: owner, requestHash: 'spec', expiresAt: at('2030-01-01T00:00:00.000Z'),
        proposedJson: { enabled: true, intervalHours: 24, initialLookbackHours: 48, membershipId: membership, actorCompanyId: platform } } });
      // The last scheduled job ended three days ago: the worker was down for two days.
      await client.billingOperation.create({ data: { stripeAccountId: gap, livemode: true, type: 'SCAN_PROVIDER_BALANCE', state: 'BLOCKED', sourceVersion: 0,
        reason: 'spec', initiatorUserId: owner, requestHash: 'spec', idempotencyKey: `scheduled-settlement:${today() - 3 * DAY}`,
        expiresAt: at('2030-01-01T00:00:00.000Z'), proposedJson: { since: today() - 4 * DAY, until: today() - 3 * DAY, membershipId: membership, actorCompanyId: platform } } });
      await service.scheduleDaily();
      const created = await client.billingOperation.findFirstOrThrow({ where: { stripeAccountId: gap, idempotencyKey: `scheduled-settlement:${today()}` } });
      assert.deepEqual([(created.proposedJson as { since: number }).since, (created.proposedJson as { until: number }).until], [today() - 3 * DAY, today()]);

      const revoked = `acct_revoked${randomUUID().replaceAll('-', '')}`;
      const revokedStripe = { enabled: true, accountId: revoked, livemode: true };
      await client.billingOperation.create({ data: { stripeAccountId: revoked, livemode: true, type: 'CONFIGURE_PROVIDER_SCANS', state: 'SUCCEEDED', sourceVersion: 0,
        reason: 'spec', initiatorUserId: owner, requestHash: 'spec', expiresAt: at('2030-01-01T00:00:00.000Z'),
        proposedJson: { enabled: true, intervalHours: 24, initialLookbackHours: 48, membershipId: membership, actorCompanyId: platform } } });
      await client.companyMembership.update({ where: { id: membership }, data: { status: 'SUSPENDED' } });
      await new BillingSettlementService({ client } as never, revokedStripe as never,
        new BillingAdminService({ client } as never, { stripe: revokedStripe } as never), {} as never).scheduleDaily();
      assert.equal(await client.billingOperation.count({ where: { stripeAccountId: revoked, type: 'SCAN_PROVIDER_BALANCE' } }), 0);
    });
  });
});

describe('billingPurchaseKind — executive spec §14.1 table', () => {
  const attemptInvoice = (quoteKind: string | null, extra: Partial<Parameters<typeof billingPurchaseKind>[0] & object> = {}) =>
    billingPurchaseKind({ productKind: 'PACKAGE', sourceAttemptId: 'attempt', subscriptionId: null, quoteKind, subscriptionConversion: false, ...extra });

  it('files each purchase where the invoice writers prove it belongs', () => {
    assert.equal(attemptInvoice('INITIAL'), 'FIRST_PURCHASE');
    assert.equal(attemptInvoice('INITIAL', { subscriptionId: 'sub_first_cycle' }), 'FIRST_PURCHASE');
    assert.equal(attemptInvoice('REPEAT'), 'RENEWAL');
    assert.equal(attemptInvoice('SCHEDULED_CHANGE'), 'RENEWAL');
    assert.equal(attemptInvoice('ADVANCE_DEAL'), 'RENEWAL');
    assert.equal(attemptInvoice('RESTART'), 'RETURN');
    // A subscription started again after it expired is a return, although it is that subscription's first cycle.
    assert.equal(attemptInvoice('RESTART', { subscriptionId: 'sub_restarted' }), 'RETURN');
    assert.equal(attemptInvoice('UPGRADE'), 'UPGRADE');
    assert.equal(attemptInvoice('FULL_PACKAGE_UPGRADE'), 'UPGRADE');
    // A subscription's own later cycle is the only invoice written without an attempt. Its snapshot is not read.
    assert.equal(billingPurchaseKind({ productKind: 'PACKAGE', sourceAttemptId: null, subscriptionId: 'sub_1', quoteKind: null, subscriptionConversion: false }), 'RENEWAL');
    assert.equal(billingPurchaseKind({ productKind: 'CHAT_CREDIT', sourceAttemptId: 'attempt', subscriptionId: null, quoteKind: 'INITIAL', subscriptionConversion: false }), 'ADD_ON');
    assert.equal(billingPurchaseKind({ productKind: 'RECEIPT_IMAGE', sourceAttemptId: null, subscriptionId: null, quoteKind: null, subscriptionConversion: false }), 'ADD_ON');
  });

  it('answers UNKNOWN for what the table cannot prove, never a guess', () => {
    assert.equal(billingPurchaseKind(null), 'UNKNOWN');
    assert.equal(attemptInvoice('INITIAL', { subscriptionConversion: true }), 'UNKNOWN');
    assert.equal(attemptInvoice(null), 'UNKNOWN');
    assert.equal(attemptInvoice('SOMETHING_NEW'), 'UNKNOWN');
    assert.equal(billingPurchaseKind({ productKind: 'PACKAGE', sourceAttemptId: null, subscriptionId: null, quoteKind: null, subscriptionConversion: false }), 'UNKNOWN');
    assert.equal(billingPurchaseKind({ productKind: 'GIFT_CARD', sourceAttemptId: 'attempt', subscriptionId: null, quoteKind: 'INITIAL', subscriptionConversion: false }), 'UNKNOWN');
  });
});
