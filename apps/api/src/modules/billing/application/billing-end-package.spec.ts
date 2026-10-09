import assert from 'node:assert/strict';
import { test } from 'node:test';
import { termProjectionHash } from '../domain/paid-invoice';
import { endPackageBlock, endPaidPackage, refundEndsPackage, stampSpentPromotion } from './billing-end-package';
import { BillingRefundsService } from './billing-refunds.service';
import { BillingReconcilerService } from './billing-reconciler.service';

const now = new Date('2026-09-24T03:00:00.000Z');
const start = new Date('2026-09-10T00:00:00.000Z'), end = new Date('2026-10-10T00:00:00.000Z');
const term = () => ({ companyId: 'company', tierKey: 'BASIC_499', branchLimit: 2, employeeLimit: 5, monthlySlipLimit: 50, billingReceiptAccountId: 'account',
  termStartAt: start, termEndsAt: end, termDisabledAt: null as Date | null, renewCount: 1, warningDays: 7 });
const account = (over: Record<string, unknown> = {}) => ({ id: 'account', companyId: 'company', renewalMode: 'CARD_ONCE', baseSubscriptionId: null as string | null,
  cancelAtPeriodEnd: false, subscriptionState: 'NONE', activeAttemptId: null as string | null, activeCollectionOperationId: null as string | null,
  pendingPlanChangeId: null as string | null, paidThrough: end as Date | null, termProjectionHash: termProjectionHash(term()), stripeAccountId: 'acct', livemode: true,
  leaseToken: 'lease', leaseUntil: new Date(Date.now() + 60_000), ...over });
const invoice = (over: Record<string, unknown> = {}) => ({ id: 'invoice', billingAccountId: 'account', providerInvoiceId: 'in_1', providerStatus: 'paid',
  applyStatus: 'APPLIED', appliedAt: start, periodStart: start, periodEnd: end, paidSatang: 49_900, totalSatang: 49_900, refundedSatang: 49_900,
  disputed: false, evidenceHash: 'evidence', contractSnapshot: null, ...over });

type Lot = { id: string; billingAccountId: string | null; companyId: string; kind: string; sourceKey: string; revokedAt: Date | null; expiresAt: Date };
/** A Prisma `where` as the end-package queries write it: equality, `in`, `gt`. */
const matches = (row: Record<string, unknown>, where: Record<string, unknown> = {}) => Object.entries(where).every(([key, want]) => {
  const op = want as { in?: unknown[]; gt?: Date } | null;
  return op && typeof op === 'object' && !(op instanceof Date) ? (op.in ? op.in.includes(row[key]) : op.gt ? (row[key] as Date) > op.gt : false) : row[key] === want;
});

/** In-memory Prisma transaction: enough rows for the end-package and applied-invoice paths, every write recorded. */
function fakeDb(rows: { company?: Record<string, unknown>; account?: Record<string, unknown>; invoice?: Record<string, unknown>;
  redemption?: Record<string, unknown> | null; lots?: Lot[] } = {}) {
  const state = { company: { id: 'company', status: 'ACTIVE', planTerm: term(), ...rows.company }, account: account(rows.account), invoice: invoice(rows.invoice),
    redemption: rows.redemption ?? null, lots: rows.lots ?? [] };
  const writes: string[] = [], audits: Record<string, unknown>[] = [];
  const tx: never = new Proxy({} as Record<string, unknown>, { get: (_, model: string) => {
    if (model === '$executeRaw' || model === '$queryRaw') return async () => [];
    if (model === '$transaction') return (fn: (inner: unknown) => unknown) => fn(tx);
    return new Proxy({}, { get: (_, method: string) => async (args: { data?: Record<string, unknown>; where?: Record<string, unknown> } = {}) => {
      if (/^(create|update|upsert|delete)/.test(method)) writes.push(`${model}.${method}`);
      if (model === 'auditLog' && method === 'create') audits.push(args.data!);
      // The promotion redemption of the invoice: the Q6 stamp only lands on a CONSUMED row that was never adjusted.
      if (model === 'billingPromotionRedemption' && method.startsWith('find')) return state.redemption;
      if (model === 'billingPromotionRedemption' && method === 'updateMany') {
        const row = state.redemption, hit = !!row && matches(row, args.where);
        if (hit) Object.assign(row, { entitlementAdjustedAt: args.data!.entitlementAdjustedAt, version: (row!.version as number) + 1 });
        return { count: hit ? 1 : 0 };
      }
      if (model === 'billingReceiptGrant' && method === 'findFirst') return state.lots.find(lot => matches(lot, args.where)) ?? null;
      if (model === 'billingReceiptGrant' && method === 'updateMany') {
        const hit = state.lots.filter(lot => matches(lot, args.where));
        for (const lot of hit) Object.assign(lot, args.data);
        return { count: hit.length };
      }
      if (model === 'company' && method.startsWith('find')) return state.company;
      if (model === 'billingAccount' && method === 'findFirst') return null;
      if (model === 'billingAccount' && method.startsWith('find')) return state.account;
      if (model === 'billingAccount' && method === 'update') return Object.assign(state.account, args.data);
      if (model === 'billingInvoice' && (method.startsWith('find') || method === 'upsert')) return state.invoice;
      if (model === 'companyPlanTerm' && method === 'update') return Object.assign(state.company.planTerm, args.data);
      if (method === 'findMany') return [];
      if (method === 'count') return 0;
      if (method === 'updateMany') return { count: 0 };
      if (method.startsWith('find')) return null;
      return { id: `${model}-row`, episode: 1, ...args.data };
    } });
  } }) as never;
  const lifecycle = { calls: [] as Record<string, unknown>[], async execute(cmd: Record<string, unknown>) { this.calls.push(cmd); state.company.status = String(cmd.targetStatus); return { id: 'company', status: String(cmd.targetStatus) }; } };
  return { state, writes, audits, tx, lifecycle };
}

test('only an applied, running, fully refunded invoice of a non-renewing package can end it', () => {
  const company = { status: 'ACTIVE', planTerm: term() };
  assert.equal(endPackageBlock(company, account(), invoice(), true, now), null);
  assert.equal(endPackageBlock(company, account(), invoice({ refundedSatang: 10_000 }), true, now), 'BILLING_END_PACKAGE_NOT_REFUNDED');
  assert.equal(endPackageBlock(company, account(), invoice({ refundedSatang: 0 }), false, now), null, 'the refund request checks before any money moves');
  // An older invoice, a stacked future period, an expired or held term all fund something else.
  assert.equal(endPackageBlock(company, account(), invoice({ periodEnd: start }), true, now), 'BILLING_END_PACKAGE_NOT_CURRENT');
  assert.equal(endPackageBlock(company, account(), invoice({ periodStart: new Date('2026-09-30T00:00:00.000Z') }), true, now), 'BILLING_END_PACKAGE_NOT_CURRENT');
  assert.equal(endPackageBlock({ status: 'ACTIVE', planTerm: { ...term(), termEndsAt: now } }, account(), invoice(), true, now), 'BILLING_END_PACKAGE_NOT_CURRENT');
  assert.equal(endPackageBlock({ status: 'DISABLED', planTerm: term() }, account(), invoice(), true, now), 'BILLING_END_PACKAGE_NOT_CURRENT');
  assert.equal(endPackageBlock(company, account(), invoice({ applyStatus: 'HELD' }), true, now), 'BILLING_END_PACKAGE_NOT_CURRENT');
  assert.equal(endPackageBlock(company, account({ termProjectionHash: 'other' }), invoice(), true, now), 'BILLING_END_PACKAGE_NOT_CURRENT');
  // A live renewal is refused until staff cancel it; cancel-at-period-end or a canceled subscription is fine.
  assert.equal(endPackageBlock(company, account({ renewalMode: 'CARD_AUTO', baseSubscriptionId: 'sub', subscriptionState: 'active' }), invoice(), true, now), 'BILLING_END_PACKAGE_AUTO_RENEW');
  assert.equal(endPackageBlock(company, account({ renewalMode: 'PROMPTPAY_RENEW', baseSubscriptionId: 'sub', subscriptionState: 'active' }), invoice(), true, now), 'BILLING_END_PACKAGE_AUTO_RENEW');
  assert.equal(endPackageBlock(company, account({ renewalMode: 'CARD_AUTO', baseSubscriptionId: 'sub', subscriptionState: 'active', cancelAtPeriodEnd: true }), invoice(), true, now), null);
  assert.equal(endPackageBlock(company, account({ renewalMode: 'CARD_AUTO', baseSubscriptionId: 'sub', subscriptionState: 'canceled' }), invoice(), true, now), null);
  assert.equal(endPackageBlock(company, account({ activeAttemptId: 'attempt' }), invoice(), true, now), 'BILLING_END_PACKAGE_PENDING');
  assert.equal(endPackageBlock(company, account({ pendingPlanChangeId: 'prepaid' }), invoice(), true, now), 'BILLING_END_PACKAGE_PENDING');
});

test('a refund ends the package only when it asked to and Stripe reports SUCCEEDED', () => {
  assert.equal(refundEndsPackage({}, 'SUCCEEDED'), false, 'default keeps the package');
  assert.equal(refundEndsPackage({ endPackage: false }, 'SUCCEEDED'), false);
  for (const terminal of ['FAILED', 'QUEUED', 'UNKNOWN', 'BLOCKED']) assert.equal(refundEndsPackage({ endPackage: true }, terminal), false, terminal);
  assert.equal(refundEndsPackage({ endPackage: true }, 'SUCCEEDED'), true);
});

test('ending writes the term-expired lock state: DISABLED by the machine actor, term and paidThrough now, grants revoked', async () => {
  const db = fakeDb();
  assert.equal(await endPaidPackage(db.tx, db.lifecycle, { companyId: 'company', accountId: 'account', invoiceId: 'invoice', requireFullRefund: true,
    actorUserId: 'admin', requestId: 'request', reason: 'refunded' }, now), null);
  assert.deepEqual(db.lifecycle.calls.map(c => [c.targetStatus, c.requestingAdminUserId]), [['DISABLED', null]], 'a human requester would clear termDisabledAt');
  assert.equal(db.state.company.planTerm.termEndsAt, now);
  assert.equal(db.state.company.planTerm.termDisabledAt, now);
  assert.equal(db.state.account.paidThrough, now, 'a new purchase restarts instead of stacking on the refunded term');
  assert.equal(db.state.account.termProjectionHash, termProjectionHash(db.state.company.planTerm), 'purchase source stays consistent');
  assert.ok(db.writes.includes('billingReceiptGrant.updateMany') && db.writes.includes('auditLog.create'));
  const refused = fakeDb({ invoice: { refundedSatang: 1 } });
  assert.equal(await endPaidPackage(refused.tx, refused.lifecycle, { companyId: 'company', accountId: 'account', invoiceId: 'invoice', requireFullRefund: true,
    actorUserId: 'admin', requestId: 'request', reason: 'refunded' }, now), 'BILLING_END_PACKAGE_NOT_REFUNDED');
  assert.deepEqual([refused.writes, refused.lifecycle.calls], [[], []]);
});

test('refund terminal step: SUCCEEDED with the choice ends it; failed, pending and default leave the package', async (t) => {
  // The service takes no clock: on the real one this term, which ends 2026-10-10, has already expired.
  t.mock.timers.enable({ apis: ['Date'], now });
  const run = async (terminal: string, endPackage: boolean | undefined, rows = {}) => {
    const db = fakeDb(rows), service = Object.assign(Object.create(BillingRefundsService.prototype), { lifecycle: db.lifecycle });
    const ended = await service.endRefundedPackage(db.tx, { endPackage }, terminal, { id: 'refund', companyId: 'company', referenceId: 'invoice', reason: 'r' }, db.state.account);
    return { ended, term: db.state.company.planTerm.termEndsAt, calls: db.lifecycle.calls.length };
  };
  assert.deepEqual(await run('SUCCEEDED', undefined), { ended: undefined, term: end, calls: 0 });
  assert.deepEqual(await run('FAILED', true), { ended: undefined, term: end, calls: 0 });
  assert.deepEqual(await run('QUEUED', true), { ended: undefined, term: end, calls: 0 });
  const ended = await run('SUCCEEDED', true);
  assert.equal(ended.ended, true);assert.equal(ended.calls, 1);assert.ok(ended.term < end);
  // Already expired or funded elsewhere: recorded as not ended, never a stuck refund.
  assert.deepEqual(await run('SUCCEEDED', true, { invoice: { periodEnd: start } }), { ended: false, term: end, calls: 0 });
  await assert.rejects(run('SUCCEEDED', true, { account: { renewalMode: 'CARD_AUTO', baseSubscriptionId: 'sub', subscriptionState: 'active' } }),
    (e: { getResponse(): { code: string } }) => e.getResponse().code === 'BILLING_END_PACKAGE_AUTO_RENEW');
});

test('standalone end requires a full refund and the current-term invoice, behind the password proof', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now }); // same reason: `endPackage` reads the clock itself
  const run = async (rows = {}) => {
    const db = fakeDb(rows), proofs: string[] = [];
    const admin = { scopedCompany: async () => ({ account: db.state.account, company: db.state.company, access: { capabilities: ['system.billing.refund.manage'] } }), access: async () => undefined };
    const service = new BillingRefundsService({ client: db.tx } as never, {} as never,
      admin as never, { requireProof: async () => { proofs.push('proof'); } } as never, db.lifecycle as never);
    const result = await service.endPackage({ userId: 'admin' } as never, 'company', 'invoice', 'refunded in Stripe');
    return { result, db, proofs };
  };
  await assert.rejects(run({ invoice: { refundedSatang: 49_899 } }), (e: { getResponse(): { code: string } }) => e.getResponse().code === 'BILLING_END_PACKAGE_NOT_REFUNDED');
  await assert.rejects(run({ invoice: { periodEnd: start } }), (e: { getResponse(): { code: string } }) => e.getResponse().code === 'BILLING_END_PACKAGE_NOT_CURRENT');
  await assert.rejects(run({ account: { renewalMode: 'CARD_AUTO', baseSubscriptionId: 'sub', subscriptionState: 'active' } }),
    (e: { getResponse(): { code: string } }) => e.getResponse().code === 'BILLING_END_PACKAGE_AUTO_RENEW');
  const ok = await run();
  assert.deepEqual(ok.proofs, ['proof']);
  assert.equal(ok.db.state.company.status, 'DISABLED');
  assert.deepEqual(ok.result, { canEnd: false, blockedReason: 'BILLING_END_PACKAGE_NOT_CURRENT' }, 'the button disappears once ended');
});

test('after ending, reconciling the old paid invoice cannot restore the term', async () => {
  const db = fakeDb();
  await endPaidPackage(db.tx, db.lifecycle, { companyId: 'company', accountId: 'account', invoiceId: 'invoice', requireFullRefund: true,
    actorUserId: 'admin', requestId: 'request', reason: 'refunded' }, now);
  const endedAt = db.state.company.planTerm.termEndsAt;
  db.writes.length = 0;db.lifecycle.calls.length = 0;
  const reconciler = new BillingReconcilerService({ client: db.tx } as never, {} as never,
    { accountId: 'acct', livemode: true } as never, {} as never, db.lifecycle as never);
  // The Stripe renewal/subscription path re-reads every paid invoice; this one ends after the cut paidThrough.
  await (reconciler as unknown as { applyInvoice: (...args: unknown[]) => Promise<void> }).applyInvoice(db.state.account, { id: 'attempt' },
    { kind: 'RENEWAL', invoiceId: 'in_1', subscriptionId: 'sub', periodStart: start, periodEnd: end, refundedSatang: 49_900, disputed: false, evidenceHash: 'evidence',
      paidSatang: 49_900, totalSatang: 49_900, taxSatang: 0, feeSatang: null, number: null, chargeId: 'ch_1', paidAt: start },
    { quote: { offer: {}, purchaseMode: 'CARD_AUTO', policyRevision: 'p' }, termHash: 'x' }, 'lease');
  assert.equal(db.state.company.planTerm.termEndsAt, endedAt);
  assert.equal(db.state.account.paidThrough, now);
  assert.equal(db.lifecycle.calls.length, 0);
  assert.ok(!db.writes.some(w => w.startsWith('companyPlanTerm') || w === 'billingAccount.update' || w.startsWith('billingReceiptGrant')), db.writes.join(','));
});

// ---- promotion purchases (spec Q6, plan R2 / R14) ----
// A monthly promotion bought on `start`: paid until `end`, free time until `benefitEnd`; the account runs on `benefitEnd`.
const benefitEnd = new Date('2026-11-10T00:00:00.000Z');
const promoTerm = () => ({ ...term(), termEndsAt: benefitEnd });
const redemption = (over: Record<string, unknown> = {}) => ({ id: 'redemption', invoiceId: 'invoice', state: 'CONSUMED', benefitAppliedAt: start,
  entitlementAdjustedAt: null as Date | null, version: 3, ...over });
const promoRows = (over: { company?: object; account?: object; invoice?: object; redemption?: object | null; lots?: Lot[] } = {}) => ({
  company: { planTerm: promoTerm(), ...over.company }, account: { paidThrough: benefitEnd, termProjectionHash: termProjectionHash(promoTerm()), ...over.account },
  invoice: { periodEnd: end, benefitEnd, ...over.invoice }, redemption: over.redemption === undefined ? redemption() : over.redemption as Record<string, unknown> | null, lots: over.lots ?? [] });
const lot = (id: string, kind: string, over: Partial<Lot> = {}): Lot => ({ id, billingAccountId: 'account', companyId: 'company', kind, sourceKey: id, revokedAt: null, expiresAt: benefitEnd, ...over });
const sourceLots = () => [lot('base', 'INITIAL', { sourceKey: 'invoice' }), lot('bonus', 'PROMOTION', { sourceKey: 'promo:invoice' })];
const renewing = { renewalMode: 'CARD_AUTO', baseSubscriptionId: 'sub', subscriptionState: 'active' };
const pin = { endPackage: true, promotionRedemptionId: 'redemption' };
const code = (e: { getResponse(): { code: string } }) => e.getResponse().code;
const ending = { companyId: 'company', accountId: 'account', invoiceId: 'invoice', requireFullRefund: true, actorUserId: 'admin', requestId: 'request', reason: 'refunded' };

test('plan R2: a promotion invoice serves until its benefit end, so that is the date the running package is matched on', () => {
  const company = { status: 'ACTIVE', planTerm: promoTerm() }, promoAccount = account({ paidThrough: benefitEnd, termProjectionHash: termProjectionHash(promoTerm()) });
  const promo = (over: Record<string, unknown> = {}) => invoice({ periodEnd: end, benefitEnd, ...over });
  assert.equal(endPackageBlock(company, promoAccount, promo(), true, now), null, 'paidThrough is the benefit end, not the paid end');
  assert.equal(endPackageBlock(company, promoAccount, promo(), true, new Date('2026-10-20T00:00:00.000Z')), null, 'still the running package in the free time');
  assert.equal(endPackageBlock(company, promoAccount, promo({ benefitEnd: null }), true, now), 'BILLING_END_PACKAGE_NOT_CURRENT', 'the paid end alone is never matched');
  assert.equal(endPackageBlock(company, promoAccount, promo({ benefitEnd: new Date('2026-12-10T00:00:00.000Z') }), true, now), 'BILLING_END_PACKAGE_NOT_CURRENT', 'another purchase ends later');
  // An invoice without a benefit end is judged exactly as before.
  assert.equal(endPackageBlock({ status: 'ACTIVE', planTerm: term() }, account(), invoice({ benefitEnd: null }), true, now), null);
  assert.equal(endPackageBlock({ status: 'ACTIVE', planTerm: term() }, account(), invoice({ benefitEnd: null, periodEnd: start }), true, now), 'BILLING_END_PACKAGE_NOT_CURRENT');
});

test('ending a promotion package revokes the bonus lot with the base lot and nothing else; the redemption is stamped once and stays CONSUMED', async () => {
  const lots = [...sourceLots(), lot('carried', 'REPEAT'), lot('expired', 'INITIAL', { expiresAt: start }), lot('already', 'PROMOTION', { revokedAt: start }),
    lot('trial', 'TRIAL_CARRYOVER'), lot('gift', 'ADMIN_ADJUSTMENT', { billingAccountId: null }), lot('addon', 'ADD_ON_PAID'), lot('event', 'SALES_EVENT'),
    lot('other-account', 'PROMOTION', { billingAccountId: 'other' }), lot('other-company', 'PROMOTION', { companyId: 'other' })];
  const db = fakeDb(promoRows({ lots }));
  assert.equal(await endPaidPackage(db.tx, db.lifecycle, ending, now), null);
  assert.deepEqual(db.state.lots.map(l => [l.id, l.revokedAt?.toISOString() ?? null]), [['base', now.toISOString()], ['bonus', now.toISOString()], ['carried', now.toISOString()],
    ['expired', null], ['already', start.toISOString()], ['trial', null], ['gift', null], ['addon', null], ['event', null], ['other-account', null], ['other-company', null]]);
  assert.ok(!db.writes.some(w => w.startsWith('receiptUnitEntry')), 'no ledger entry: a unit held by a running read settles on its lot, never below zero');
  assert.deepEqual([db.state.redemption!.state, db.state.redemption!.entitlementAdjustedAt, db.state.redemption!.version], ['CONSUMED', now, 4]);
  assert.deepEqual(db.writes.filter(w => w.startsWith('billingPromotionRedemption')), ['billingPromotionRedemption.updateMany'], 'only the stamp: no release, delete or state change');
  assert.equal((db.audits.at(-1)!.metadataJson as Record<string, unknown>).promotionEntitlementAdjusted, true);
  // A replay is a benign no-op: the package is no longer current, nothing is written and the stamp does not move.
  db.writes.length = 0;
  assert.equal(await endPaidPackage(db.tx, db.lifecycle, ending, new Date('2026-09-25T03:00:00.000Z')), 'BILLING_END_PACKAGE_NOT_CURRENT');
  assert.equal(await stampSpentPromotion(db.tx, { accountId: 'account', invoiceId: 'invoice' }, new Date('2026-09-25T03:00:00.000Z')), false);
  assert.deepEqual([db.writes.filter(w => !w.endsWith('updateMany')), db.state.redemption!.entitlementAdjustedAt, db.state.redemption!.version], [[], now, 4]);
  // Nothing left to revoke (everything expired or already revoked) still stamps; a plain invoice has nothing to stamp.
  const spent = fakeDb(promoRows({ lots: [lot('base', 'INITIAL', { sourceKey: 'invoice', expiresAt: start }), lot('bonus', 'PROMOTION', { sourceKey: 'promo:invoice', revokedAt: start })] }));
  assert.equal(await endPaidPackage(spent.tx, spent.lifecycle, ending, now), null);
  assert.equal(spent.state.redemption!.entitlementAdjustedAt, now);
  const plain = fakeDb();
  assert.equal(await endPaidPackage(plain.tx, plain.lifecycle, ending, now), null);
  assert.equal(plain.audits.at(-1)!.metadataJson && 'promotionEntitlementAdjusted' in (plain.audits.at(-1)!.metadataJson as object), false);
});

test('promotion Q6 at preview: a cumulative-full refund forces the end and pins the redemption, a partial one keeps everything, other invoices follow the operator', async () => {
  const decide = async (rows: object, previous: number, amount: number, endPackage?: boolean) => {
    const db = fakeDb(rows), service = Object.assign(Object.create(BillingRefundsService.prototype), { prisma: { client: db.tx } });
    return service.refundEnd('invoice', 24_900, previous, { amountSatang: amount, endPackage });
  };
  const forced = { endPackage: true, promotionRedemptionId: 'redemption' }, kept = { endPackage: false, promotionRedemptionId: 'redemption' };
  assert.deepEqual(await decide(promoRows(), 0, 24_900), forced, 'full in one refund, the operator said nothing');
  assert.deepEqual(await decide(promoRows(), 0, 24_900, false), forced, 'the operator said no');
  assert.deepEqual(await decide(promoRows(), 0, 24_900, true), forced);
  assert.deepEqual(await decide(promoRows(), 10_000, 14_900), forced, 'cumulative: earlier partial refunds count');
  assert.deepEqual(await decide(promoRows(), 0, 24_899), kept, 'one satang short keeps time and quota');
  assert.deepEqual(await decide(promoRows(), 10_000, 14_899, false), kept);
  for (const [previous, amount] of [[0, 10_000], [10_000, 14_899]])
    await assert.rejects(decide(promoRows(), previous!, amount!, true), (e: { getResponse(): { code: string } }) => code(e) === 'BILLING_END_PACKAGE_NOT_REFUNDED');
  // Any other invoice: the operator's choice, full or not, exactly as before, and nothing is pinned.
  for (const [previous, amount] of [[0, 24_900], [0, 100], [10_000, 14_900]]) for (const flag of [true, false, undefined])
    assert.deepEqual(await decide({}, previous!, amount!, flag), { endPackage: flag === true });
});

test('a promotion refund tolerates a source with nothing running, never a live renewal or a pending purchase; other invoices stay strict', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const block = async (rows: object, p: object) => {
    const db = fakeDb(rows);
    return Object.create(BillingRefundsService.prototype).refundBlock(db.tx, db.state.account, 'invoice', p);
  };
  assert.equal(await block(promoRows(), pin), null, 'the running package: it will end');
  // Nothing running to end: not started, held, over, replaced. The refund still goes and staff adjust the entitlement.
  assert.equal(await block(promoRows({ invoice: { periodStart: new Date('2026-09-30T00:00:00.000Z') } }), pin), null, 'bought in advance, not started');
  assert.equal(await block(promoRows({ invoice: { applyStatus: 'HELD', appliedAt: null } }), pin), null, 'paid, not applied');
  assert.equal(await block(promoRows({ account: { paidThrough: start } }), pin), null, 'service over');
  assert.equal(await block(promoRows({ invoice: { benefitEnd: new Date('2026-10-20T00:00:00.000Z') } }), pin), null, 'another purchase runs after it');
  // A live renewal would charge the card at benefit end after a full refund; a pending purchase or plan change is unresolved.
  assert.equal(await block(promoRows({ account: renewing }), pin), 'BILLING_END_PACKAGE_AUTO_RENEW');
  assert.equal(await block(promoRows({ account: { ...renewing, renewalMode: 'PROMPTPAY_RENEW' } }), pin), 'BILLING_END_PACKAGE_AUTO_RENEW');
  assert.equal(await block(promoRows({ account: { ...renewing, cancelAtPeriodEnd: true } }), pin), null, 'renewal already stopped');
  assert.equal(await block(promoRows({ account: { pendingPlanChangeId: 'change' } }), pin), 'BILLING_END_PACKAGE_PENDING');
  // A partial refund asks for no end, so a renewing source is not its business.
  assert.equal(await block(promoRows({ account: renewing }), { endPackage: false, promotionRedemptionId: 'redemption' }), null);
  // An invoice that is not a promotion purchase keeps today's strictness.
  assert.equal(await block({ invoice: { periodEnd: start } }, { endPackage: true }), 'BILLING_END_PACKAGE_NOT_CURRENT');
  assert.equal(await block({}, { endPackage: true }), null);
  assert.equal(await block({ invoice: { periodEnd: start } }, {}), null);
});

test('promotion refund terminal step: a running source ends and is stamped, a spent one is stamped, any other waits for staff; always CONSUMED', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const run = async (rows: object, p: object = pin, terminal = 'SUCCEEDED') => {
    const db = fakeDb(rows), service = Object.assign(Object.create(BillingRefundsService.prototype), { lifecycle: db.lifecycle });
    const ended = await service.endRefundedPackage(db.tx, p, terminal, { id: 'refund', companyId: 'company', referenceId: 'invoice', reason: 'r' }, db.state.account);
    return { ended, db, stamped: db.state.redemption!.entitlementAdjustedAt, state: db.state.redemption!.state, ended_calls: db.lifecycle.calls.length };
  };
  // Running: the package ends, the base and bonus lots are revoked, the stamp lands, the right stays used.
  const running = await run(promoRows({ lots: sourceLots() }));
  assert.deepEqual([running.ended, running.stamped, running.state, running.ended_calls, running.db.state.lots.every(l => l.revokedAt?.getTime() === now.getTime())], [true, now, 'CONSUMED', 1, true]);
  // Not started: no entitlement change, not stamped, so the report shows it pending.
  const future = await run(promoRows({ invoice: { periodStart: new Date('2026-09-30T00:00:00.000Z') }, lots: sourceLots() }));
  assert.deepEqual([future.ended, future.stamped, future.ended_calls, future.db.state.lots.some(l => l.revokedAt)], [false, null, 0, false]);
  // Held, paid but never applied: no grants exist and none are made here; not stamped.
  const held = await run(promoRows({ invoice: { applyStatus: 'HELD', appliedAt: null }, redemption: redemption({ benefitAppliedAt: null }) }));
  assert.deepEqual([held.ended, held.stamped, held.ended_calls], [false, null, 0]);
  // Spent: the service is over and every lot of the source is gone, so nothing is left to end; stamped, still CONSUMED.
  const gone = [lot('base', 'INITIAL', { sourceKey: 'invoice', expiresAt: start }), lot('bonus', 'PROMOTION', { sourceKey: 'promo:invoice', revokedAt: start })];
  const spent = await run(promoRows({ account: { paidThrough: start }, lots: gone }));
  assert.deepEqual([spent.ended, spent.stamped, spent.state, spent.ended_calls], [false, now, 'CONSUMED', 0]);
  // Replaced, with unused base units carried into the later purchase: they are still live, so staff decide; not stamped.
  const carried = await run(promoRows({ account: { paidThrough: new Date('2026-12-10T00:00:00.000Z') }, lots: [lot('base', 'INITIAL', { sourceKey: 'invoice', expiresAt: new Date('2026-12-10T00:00:00.000Z') }), gone[1]!] }));
  assert.deepEqual([carried.ended, carried.stamped], [false, null]);
  // A live renewal still refuses at execute, and nothing is stamped.
  await assert.rejects(run(promoRows({ account: renewing })), (e: { getResponse(): { code: string } }) => code(e) === 'BILLING_END_PACKAGE_AUTO_RENEW');
  // A partial refund, or one that did not reach SUCCEEDED, asks for no end.
  for (const [p, terminal] of [[{ endPackage: false, promotionRedemptionId: 'redemption' }, 'SUCCEEDED'], [pin, 'FAILED'], [pin, 'QUEUED']] as const) {
    const idle = await run(promoRows({ lots: sourceLots() }), p, terminal);
    assert.deepEqual([idle.ended, idle.stamped, idle.ended_calls, idle.db.writes], [undefined, null, 0, []]);
  }
  // Execute answers for the source it previewed: another or a missing pin is a review case and nothing is written.
  for (const p of [{ endPackage: true, promotionRedemptionId: 'other' }, { endPackage: true }]) {
    const db = fakeDb(promoRows({ lots: sourceLots() })), service = Object.assign(Object.create(BillingRefundsService.prototype), { lifecycle: db.lifecycle });
    await assert.rejects(service.endRefundedPackage(db.tx, p, 'SUCCEEDED', { id: 'refund', companyId: 'company', referenceId: 'invoice', reason: 'r' }, db.state.account),
      (e: { getResponse(): { code: string } }) => code(e) === 'CONTROL_REFUND_SOURCE_CHANGED');
    assert.deepEqual([db.writes, db.lifecycle.calls.length], [[], 0]);
  }
  // A replay of the same terminal step ends nothing again and does not move the stamp.
  const db = fakeDb(promoRows({ lots: sourceLots() })), service = Object.assign(Object.create(BillingRefundsService.prototype), { lifecycle: db.lifecycle });
  const step = () => service.endRefundedPackage(db.tx, pin, 'SUCCEEDED', { id: 'refund', companyId: 'company', referenceId: 'invoice', reason: 'r' }, db.state.account);
  assert.equal(await step(), true);
  t.mock.timers.setTime(now.getTime() + 3_600_000);
  assert.equal(await step(), false);
  assert.deepEqual([db.state.redemption!.entitlementAdjustedAt, db.state.redemption!.version, db.lifecycle.calls.length], [now, 4, 1]);
});

test('standalone end of a fully refunded promotion package ends it through its benefit end and stamps the redemption', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const run = async (rows = {}) => {
    const db = fakeDb(promoRows({ lots: sourceLots(), ...rows }));
    const admin = { scopedCompany: async () => ({ account: db.state.account, company: db.state.company, access: { capabilities: ['system.billing.refund.manage'] } }), access: async () => undefined };
    const service = new BillingRefundsService({ client: db.tx } as never, {} as never, admin as never, { requireProof: async () => undefined } as never, db.lifecycle as never);
    return { result: await service.endPackage({ userId: 'admin' } as never, 'company', 'invoice', 'refunded in Stripe'), db };
  };
  await assert.rejects(run({ invoice: { refundedSatang: 100 } }), (e: { getResponse(): { code: string } }) => code(e) === 'BILLING_END_PACKAGE_NOT_REFUNDED');
  await assert.rejects(run({ account: renewing }), (e: { getResponse(): { code: string } }) => code(e) === 'BILLING_END_PACKAGE_AUTO_RENEW');
  const ok = await run();
  assert.deepEqual(ok.result, { canEnd: false, blockedReason: 'BILLING_END_PACKAGE_NOT_CURRENT' });
  assert.deepEqual([ok.db.state.company.status, ok.db.state.redemption!.state, ok.db.state.redemption!.entitlementAdjustedAt, ok.db.state.lots.every(l => l.revokedAt?.getTime() === now.getTime())], ['DISABLED', 'CONSUMED', now, true]);
});
