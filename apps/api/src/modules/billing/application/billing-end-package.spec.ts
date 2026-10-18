import assert from 'node:assert/strict';
import { test } from 'node:test';
import { termProjectionHash } from '../domain/paid-invoice';
import { endPackageBlock, endPaidPackage, refundEndsPackage, stampSpentPromotion } from './billing-end-package';
import { BillingRefundsService, refundLocalHash } from './billing-refunds.service';
import { BillingReconcilerService } from './billing-reconciler.service';
import { StripeRequestError } from '../infrastructure/stripe.client';
import { configurationHash } from '../domain/billing-policy';
import { refundParams, refundPreview, refundSource } from './billing-refund-source';

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
  redemption?: Record<string, unknown> | null; lots?: Lot[]; attempt?: Record<string, unknown> | null } = {}) {
  const state = { company: { id: 'company', status: 'ACTIVE', planTerm: term(), ...rows.company }, account: account(rows.account), invoice: invoice(rows.invoice),
    redemption: rows.redemption ?? null, lots: rows.lots ?? [] };
  const writes: string[] = [], audits: Record<string, unknown>[] = [], issues: Record<string, unknown>[] = [];
  const tx: never = new Proxy({} as Record<string, unknown>, { get: (_, model: string) => {
    if (model === '$executeRaw' || model === '$queryRaw') return async () => [];
    if (model === '$transaction') return (fn: (inner: unknown) => unknown) => fn(tx);
    return new Proxy({}, { get: (_, method: string) => async (args: { data?: Record<string, unknown>; where?: Record<string, unknown> } = {}) => {
      if (/^(create|update|upsert|delete)/.test(method)) writes.push(`${model}.${method}`);
      if (model === 'auditLog' && method === 'create') audits.push(args.data!);
      // BillingIssue: the unique (stripeAccountId, livemode, kind, referenceId) the detector locks and reads by, so a second detect finds the first.
      if (model === 'billingIssue' && method === 'findUnique') {
        const key = (args.where as { stripeAccountId_livemode_kind_referenceId: Record<string, unknown> }).stripeAccountId_livemode_kind_referenceId;
        return issues.find(issue => Object.entries(key).every(([field, want]) => issue[field] === want)) ?? null;
      }
      if (model === 'billingIssue' && method === 'create') { const row = { id: `issue-${issues.length + 1}`, state: 'OPEN', episode: 1, ...args.data }; issues.push(row); return row; }
      if (model === 'billingIssue' && method === 'update') return Object.assign(issues.find(issue => issue.id === args.where!.id)!, args.data);
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
      if (model === 'billingAttempt' && method.startsWith('find')) return rows.attempt ?? null;
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
  return { state, writes, audits, issues, tx, lifecycle };
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

test('the refund screens are told the promotion of the invoice from its redemption and its own snapshot; any other invoice tells nothing', async () => {
  const told = (rows: object, row: object | null) => Object.assign(Object.create(BillingRefundsService.prototype), { prisma: { client: fakeDb(rows).tx } }).promotion(row);
  const sized = promoRows({ redemption: redemption({ bonusMonths: 1, bonusReceiptUnits: 30 }) }), snapshot = { promotion: { displayName: 'ซื้อ 1 แถม 1' } };
  assert.deepEqual(await told(sized, { id: 'invoice', contractSnapshot: snapshot, benefitEnd }),
    { promotion: { displayName: 'ซื้อ 1 แถม 1', bonusMonths: 1, bonusReceiptUnits: 30, benefitEnd: benefitEnd.toISOString() } });
  assert.deepEqual(await told(sized, { id: 'invoice', contractSnapshot: null, benefitEnd: null }),
    { promotion: { displayName: '', bonusMonths: 1, bonusReceiptUnits: 30, benefitEnd: null } }, 'a right used but never applied is still told');
  assert.deepEqual(await told({}, { id: 'invoice', contractSnapshot: snapshot, benefitEnd }), {}, 'no redemption: the field is absent');
  assert.deepEqual(await told(sized, null), {});
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

// ---- plan R14: the renewal guard of a promotion refund, and the review for a source nothing could end ----
/**
 * Owner 2026-10-10, option "ค", second half: the purchase that still holds the shop's slot may be refunded — and its package ended —
 * once the system can no longer set up its renewal (`unrepairableBinding`). Everything else that holds the slot stays refused.
 */
test('a purchase whose renewal the provider refused can be refunded and ended although it holds the slot; a binding still being repaired cannot', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const refused = { generation: 2, at: '2026-09-24T01:00:00.000Z', status: 400, code: null };
  const attempt = (over: Record<string, unknown> = {}) => ({ id: 'attempt', billingAccountId: 'account', subscriptionId: null,
    quoteSnapshot: { quote: { purchaseMode: 'PROMPTPAY_RENEW' } }, collectionJson: { qrSubscriptionRequestedAt: '2026-09-24T00:59:00.000Z', qrSubscriptionGeneration: 2, qrSubscriptionRefused: refused }, ...over });
  const held = (over: { attempt?: Record<string, unknown> | null; invoice?: object; account?: object } = {}) => ({ attempt: over.attempt === undefined ? attempt() : over.attempt,
    account: { renewalMode: 'PROMPTPAY_RENEW', activeAttemptId: 'attempt', customerId: 'cus_1', ...over.account }, invoice: { sourceAttemptId: 'attempt', refundedSatang: 0, version: 1, ...over.invoice } });
  const repairing = attempt({ collectionJson: { qrSubscriptionRequestedAt: '2026-09-24T02:30:00.000Z' } });
  const service = (db: ReturnType<typeof fakeDb>) => Object.assign(Object.create(BillingRefundsService.prototype), { prisma: { client: db.tx },
    billing: { usage: async () => ({}), account: async () => db.state.account }, policy: async () => ({ settings: { version: 1 }, revision: { id: 'rev' } }),
    source: async () => ({ account: db.state.account, row: db.state.invoice, company: { name: 'ร้านทดสอบ' }, access: { capabilities: ['system.billing.refund.manage'] },
      state: { gates: { refunds: true }, policy: { refundLimitSatang: 100_000 } }, sourceHash: 'hash',
      source: { charge: { disputed: false, amount_refunded: 0 }, refunds: [], invoice: { post_payment_credit_notes_amount: 0 }, adjustments: [] } }) });
  const review = async (rows: Parameters<typeof fakeDb>[0]) => { const r = await service(fakeDb(rows)).review({} as never, 'company', 'invoice'); return [r.canCreate, r.blockedReason, r.unrepairedBinding ?? null]; };

  // The refund review.
  assert.deepEqual(await review(held()), [true, null, 'RENEWAL'], 'the provider refused the renewal: the refund is the way out');
  assert.deepEqual(await review(held({ attempt: repairing })), [false, 'BILLING_REFUND_PENDING', null], 'the system is still repairing: a refund could race a send');
  assert.deepEqual(await review(held({ invoice: { sourceAttemptId: 'earlier' } })), [false, 'BILLING_REFUND_PENDING', null], 'any other invoice of the shop');
  assert.deepEqual(await review(held({ attempt: attempt({ quoteSnapshot: { repeat: {}, quote: {} } }) })), [false, 'BILLING_REFUND_PENDING', null], 'a repeat purchase: its unwind is not built');
  assert.deepEqual(await review(held({ account: { activeCollectionOperationId: 'command' } })), [false, 'BILLING_REFUND_PENDING', null], 'a renewal command still holds');

  // Ending the package with that refund: no subscription exists to cancel first, and this purchase is not a pending one to wait for.
  const block = async (rows: Parameters<typeof fakeDb>[0], p: object = { endPackage: true }) => { const db = fakeDb(rows); return service(db).refundBlock(db.tx, db.state.account, 'invoice', p); };
  assert.equal(await block(held()), null);
  assert.equal(await block(held({ attempt: repairing })), 'BILLING_END_PACKAGE_AUTO_RENEW');
  assert.equal(await block(held({ account: { renewalMode: 'CARD_ONCE' }, attempt: repairing })), 'BILLING_END_PACKAGE_PENDING');
  assert.equal(await block(held({ account: { pendingPlanChangeId: 'change' } })), 'BILLING_END_PACKAGE_PENDING', 'everything else that holds the shop still does');
  assert.equal(endPackageBlock({ status: 'ACTIVE', planTerm: term() }, account({ renewalMode: 'PROMPTPAY_RENEW', activeAttemptId: 'attempt' }), invoice(), true, now, true), null);
  assert.equal(endPackageBlock({ status: 'ACTIVE', planTerm: term() }, account({ renewalMode: 'PROMPTPAY_RENEW', activeAttemptId: 'attempt' }), invoice({ refundedSatang: 100 }), true, now, true), 'BILLING_END_PACKAGE_NOT_REFUNDED');
  const ended = fakeDb(held({ invoice: { refundedSatang: 49_900 } }));
  assert.equal(await endPaidPackage(ended.tx, ended.lifecycle as never, ending, now), null, 'the standalone end of the fully refunded purchase');

  // Submit, approve and dispatch re-check the binding the proposal was previewed against.
  const pinned = `attempt:refused:${refused.generation}:${refused.at}`;
  const current = async (rows: Parameters<typeof fakeDb>[0], pin: string | null = pinned) => {
    const db = fakeDb(rows), first = fakeDb(held());
    const row = { id: 'refund', companyId: 'company', referenceId: 'invoice', expiresAt: new Date(now.getTime() + 600_000),
      proposedJson: { accountId: 'account', amountSatang: 1000, settingsVersion: 1, policyRevisionId: 'rev', localHash: refundLocalHash(first.state.account as never, first.state.invoice as never, pin) } };
    return service(db).current(row, db.tx).then(() => 'ok', (e: { getResponse(): { code: string } }) => code(e));
  };
  assert.equal(await current(held()), 'ok');
  assert.equal(await current(held(), null), 'CONTROL_PREVIEW_STALE', 'a proposal that did not pin this binding');
  assert.equal(await current(held({ attempt: attempt({ collectionJson: { qrSubscriptionRefused: { ...refused, generation: 3, at: '2026-09-24T02:50:00.000Z' } } }) })), 'CONTROL_PREVIEW_STALE', 'another refusal than the one previewed');
  assert.equal(await current(held({ attempt: repairing })), 'CONTROL_PREVIEW_STALE', 'the marker is gone: the system repairs again');
  assert.equal(await current(held({ attempt: attempt({ subscriptionId: 'sub_1' }) })), 'CONTROL_PREVIEW_STALE', 'a subscription was bound');
  assert.equal(await current(held({ account: { activeAttemptId: 'next' } })), 'CONTROL_PREVIEW_STALE', 'the slot moved to another attempt');
});

const DAY = 86_400_000;
type Rows = { company?: object; account?: object; invoice?: object; redemption?: object | null; lots?: Lot[] };
const withRenewal = (over: Rows, stopped: object = {}): Rows => ({ ...over, account: { ...over.account, ...renewing, ...stopped } });
// Each of these makes the promotion source not the running package. The old gate read that as "nothing to end" and never looked at the renewal.
const notRunning: Record<string, Rows> = {
  'company not active': { company: { status: 'SUSPENDED' } },
  'term changed by hand': { account: { termProjectionHash: 'other' } },
  'paid through moved by gift days': { account: { paidThrough: new Date(benefitEnd.getTime() + 5 * DAY) } },
  'bought in advance, not started': { invoice: { periodStart: new Date('2026-09-30T00:00:00.000Z') } },
  'paid, not applied': { invoice: { applyStatus: 'HELD', appliedAt: null } },
};

test('plan R14: a promotion refund keeps the renewal guard whatever else makes its source not the running package; other invoices are judged as before', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const AUTO = 'BILLING_END_PACKAGE_AUTO_RENEW', NOT_CURRENT = 'BILLING_END_PACKAGE_NOT_CURRENT';
  const block = async (rows: object, p: object) => {
    const db = fakeDb(rows);
    return Object.create(BillingRefundsService.prototype).refundBlock(db.tx, db.state.account, 'invoice', p);
  };
  for (const [name, over] of Object.entries(notRunning)) {
    assert.equal(await block(promoRows(withRenewal(over)), pin), AUTO, `${name}: a live renewal would still charge at the benefit end`);
    assert.equal(await block(promoRows(over), pin), null, `${name}: without a renewal the refund goes and staff adjust the entitlement`);
    for (const stopped of [{ cancelAtPeriodEnd: true }, { subscriptionState: 'canceled' }, { subscriptionState: 'incomplete_expired' }])
      assert.equal(await block(promoRows(withRenewal(over, stopped)), pin), null, `${name}: a renewal already stopped is no reason`);
    assert.equal(await block(promoRows(withRenewal(over)), { endPackage: false, promotionRedemptionId: 'redemption' }), null, `${name}: a partial refund asks for no end`);
  }
  // The renewal belongs to the source only while its service runs: one that ended on or before now has nothing left to charge for.
  const ends = (at: Date) => promoRows(withRenewal({ invoice: { periodEnd: new Date('2026-09-15T00:00:00.000Z'), benefitEnd: at } }));
  assert.equal(await block(ends(new Date('2026-09-20T00:00:00.000Z')), pin), null, 'service over: the renewal pays for later time');
  assert.equal(await block(ends(now), pin), null, 'ending exactly now is over');
  assert.equal(await block(ends(new Date(now.getTime() + 1)), pin), AUTO);
  assert.equal(await block(promoRows(withRenewal({})), pin), AUTO, 'the running package: endPackageBlock itself');
  // An invoice that is not a promotion purchase is judged by endPackageBlock alone, exactly as on main: the same states, renewal or not.
  for (const [name, over] of Object.entries({ ...notRunning, 'running': {}, 'service over': { invoice: { periodEnd: start, benefitEnd: null } } } as Record<string, Rows>))
    for (const renewal of [false, true]) {
      const rows = { ...promoRows(renewal ? withRenewal(over) : over), redemption: null }, db = fakeDb(rows);
      const expected = endPackageBlock(db.state.company as never, db.state.account, db.state.invoice, false);
      assert.equal(await block(rows, { endPackage: true }), expected, `${name}${renewal ? ' with a renewal' : ''}`);
      assert.equal(await block(rows, {}), null, `${name}: no end asked`);
      if (name !== 'running') assert.equal(expected, NOT_CURRENT, `${name}: still refused at preview, never tolerated`);
    }
});

test('plan R14: a fully refunded promotion source nothing could end or settle is opened as a review on its invoice, once; the right stays used', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const row = { id: 'refund', companyId: 'company', stripeAccountId: 'acct', livemode: true, referenceId: 'invoice', reason: 'r' };
  const run = async (rows: object, p: object = pin, terminal = 'SUCCEEDED') => {
    const db = fakeDb(rows), service = Object.assign(Object.create(BillingRefundsService.prototype), { lifecycle: db.lifecycle });
    const step = () => service.endRefundedPackage(db.tx, p, terminal, row, db.state.account);
    return { db, step, ended: await step() as boolean | undefined };
  };
  const seen = (db: ReturnType<typeof fakeDb>) => db.issues.map(issue => [issue.kind, issue.referenceId, issue.companyId, issue.stripeAccountId, issue.livemode, issue.state]);
  const review = [['PROMOTION_REVIEW', 'invoice', 'company', 'acct', true, 'OPEN']];
  const later = new Date('2026-12-10T00:00:00.000Z');
  const needStaff: Record<string, object> = {
    'not started': promoRows({ invoice: { periodStart: new Date('2026-09-30T00:00:00.000Z') }, lots: sourceLots() }),
    'paid, not applied': promoRows({ invoice: { applyStatus: 'HELD', appliedAt: null }, redemption: redemption({ benefitAppliedAt: null }) }),
    'replaced, its base units carried into a later purchase': promoRows({ account: { paidThrough: later }, lots: [lot('base', 'INITIAL', { sourceKey: 'invoice', expiresAt: later }),
      lot('bonus', 'PROMOTION', { sourceKey: 'promo:invoice', revokedAt: start })] }),
    'a renewal that went live after the gate': promoRows({ account: { ...renewing, paidThrough: new Date(benefitEnd.getTime() + 5 * DAY) }, lots: sourceLots() }),
  };
  for (const [name, rows] of Object.entries(needStaff)) {
    const first = await run(rows);
    assert.deepEqual([first.ended, seen(first.db), first.db.writes], [false, review, ['billingIssue.create', 'auditLog.create']], `${name}: nothing else is written`);
    assert.deepEqual([first.db.state.redemption!.state, first.db.state.redemption!.entitlementAdjustedAt, first.db.state.redemption!.version, first.db.lifecycle.calls.length],
      ['CONSUMED', null, 3, 0], `${name}: the right stays used and unadjusted`);
    assert.equal(await first.step(), false);
    assert.deepEqual([seen(first.db), first.db.writes.filter(w => w === 'billingIssue.create')], [review, ['billingIssue.create']], `${name}: a replay finds the first review`);
  }
  // Nothing for staff: ended, settled, or adjusted before. A source that is not a promotion purchase is left alone exactly as before.
  const gone = [lot('base', 'INITIAL', { sourceKey: 'invoice', expiresAt: start }), lot('bonus', 'PROMOTION', { sourceKey: 'promo:invoice', revokedAt: start })];
  const quiet: Record<string, [object, object, boolean]> = {
    'ended now': [promoRows({ lots: sourceLots() }), pin, true],
    'spent, so settled now': [promoRows({ account: { paidThrough: start }, lots: gone }), pin, false],
    'adjusted before (an earlier end, or a replay)': [promoRows({ account: { paidThrough: start }, lots: gone, redemption: redemption({ entitlementAdjustedAt: start }) }), pin, false],
    'not a promotion purchase': [{ ...promoRows({ invoice: { periodStart: new Date('2026-09-30T00:00:00.000Z') } }), redemption: null }, { endPackage: true }, false],
  };
  for (const [name, [rows, p, ended]] of Object.entries(quiet)) {
    const r = await run(rows, p);
    assert.deepEqual([r.ended, r.db.issues.length, r.db.writes.filter(w => w.startsWith('billingIssue'))], [ended, 0, []], name);
  }
  // A refund that did not reach SUCCEEDED, or a partial one, asks for no end and writes nothing.
  for (const [p, terminal] of [[pin, 'FAILED'], [{ endPackage: false, promotionRedemptionId: 'redemption' }, 'SUCCEEDED']] as const) {
    const r = await run(needStaff['not started'] as object, p, terminal);
    assert.deepEqual([r.ended, r.db.issues.length, r.db.writes], [undefined, 0, []]);
  }
});

/** `execute` of an approved refund on an in-memory row, with a provider whose answers pass every source check, so the run reaches the real `POST /credit_notes`.
 *  `error` is thrown by the `nth` call of `at`. The claim, fence, dispatch, journal write, review case and audit are the real code; the actor and staleness gates are not under test. */
async function refundRun(error: Error, at = 'GET /invoices/in_1', journal: Record<string, unknown> = {}, nth = 1) {
  const db = fakeDb(), logged: unknown[] = [], calls: string[] = [], paid = 24_900, amount = 10_000;
  const account = { id: 'account', companyId: 'company', stripeAccountId: 'acct', livemode: true, customerId: 'cus_1', leaseToken: null as string | null, leaseUntil: null as Date | null };
  const inv = { id: 'invoice', billingAccountId: 'account', providerInvoiceId: 'in_1', providerChargeId: 'ch_1', subscriptionId: null, currency: 'THB', providerStatus: 'paid',
    paidSatang: paid, totalSatang: paid, taxSatang: 0, contractSnapshot: { quote: { purchaseMode: 'PROMPTPAY_ONCE' } } };
  const list = (data: unknown[]) => ({ object: 'list', data, has_more: false });
  const answers: Record<string, (params: Record<string, any>) => unknown> = {
    'GET /invoices/in_1': () => ({ id: 'in_1', object: 'invoice', livemode: true, customer: 'cus_1', currency: 'thb', status: 'paid', total: paid, amount_paid: paid, amount_remaining: 0, starting_balance: 0,
      paid_out_of_band: false, post_payment_credit_notes_amount: 0, total_taxes: [] }),
    'GET /charges/ch_1': () => ({ id: 'ch_1', livemode: true, customer: 'cus_1', currency: 'thb', status: 'succeeded', paid: true, captured: true, amount: paid, amount_refunded: 0, disputed: false,
      payment_intent: 'pi_1', payment_method_details: { type: 'promptpay' } }),
    'GET /invoice_payments': () => list([{ id: 'inpay_1', object: 'invoice_payment', livemode: true, invoice: 'in_1', status: 'paid', currency: 'thb', amount_paid: paid, payment: { type: 'payment_intent', payment_intent: 'pi_1' } }]),
    'GET /payment_intents/pi_1': () => ({ id: 'pi_1', object: 'payment_intent', livemode: true, customer: 'cus_1', currency: 'thb', status: 'succeeded', amount_received: paid, latest_charge: 'ch_1' }),
    'GET /credit_notes': () => list([]), 'GET /refunds': () => list([]),
    'GET /invoices/in_1/lines': () => list([{ id: 'il_1', livemode: true, currency: 'thb', amount: paid }]),
    'GET /credit_notes/preview': params => ({ object: 'credit_note', livemode: true, currency: 'thb', invoice: 'in_1', customer: 'cus_1', amount: params.refund_amount, total: params.refund_amount, type: 'post_payment',
      pre_payment_amount: 0, post_payment_amount: params.refund_amount, status: 'issued', customer_balance_transaction: null, out_of_band_amount: 0, amount_shipping: 0, total_excluding_tax: params.refund_amount, total_taxes: [],
      lines: list(params.lines.map((line: Record<string, unknown>) => ({ object: 'credit_note_line_item', livemode: true, taxes: [], ...line }))) }),
    'POST /credit_notes': () => ({}), // nothing is listed afterwards: a create that answered but left no note is a review, never a success
  };
  let armed = false, seen = 0;
  const stripe = { accountId: 'acct', livemode: true, assertAccount: async () => undefined, request: async (method: string, path: string, params: Record<string, any> = {}) => {
    const key = `${method} ${path}`; if (armed) calls.push(key);
    if (armed && key === at && ++seen === nth) throw error;
    return answers[key]!(params);
  } };
  const source = await refundSource(stripe as never, account as never, inv as never), params = await refundParams(stripe as never, account as never, inv as never, source, 'refund', amount, '', false);
  const proposed = { accountId: 'account', customerId: 'cus_1', chargeId: 'ch_1', providerSourceHash: source.sourceHash, amountSatang: amount, memo: '', endPackage: true, params,
    projection: await refundPreview(stripe as never, account as never, inv as never, source, params) };
  const op: Record<string, any> = { id: 'refund', companyId: 'company', stripeAccountId: 'acct', livemode: true, type: 'REFUND', state: journal.dispatchedAt ? 'UNKNOWN' : 'QUEUED', version: 3, referenceId: 'invoice', initiatorUserId: 'admin',
    approverUserId: 'admin', errorCode: null, reason: 'r', requestHash: configurationHash(['refund', 'invoice', proposed, 'r']), sourceVersion: 1, leaseToken: null, leaseUntil: null, observedAt: null, createdAt: new Date(),
    expiresAt: new Date(Date.now() + 600_000), proposedJson: proposed, resultJson: journal };
  const apply = (data: Record<string, any>) => Object.assign(op, data, data.version ? { version: op.version + 1 } : {});
  const own: Record<string, unknown> = {
    billingOperation: { findUniqueOrThrow: async () => op, update: async ({ data }: any) => apply(data), updateMany: async ({ data }: any) => (apply(data), { count: 1 }) },
    billingAccount: { updateMany: async ({ data }: any) => (Object.assign(account, data), { count: 1 }) },
    billingInvoice: { findFirst: async () => inv, findUnique: async () => inv, update: async () => inv },
  };
  const tx: any = new Proxy({}, { get: (_, key: string) => key === '$transaction' ? (fn: (inner: unknown) => unknown) => fn(tx) : own[key] ?? (db.tx as any)[key] });
  const admin = { scopedCompany: async () => ({ account, company: { name: 'ร้านทดสอบ' }, access: { capabilities: ['system.billing.financial.read', 'system.billing.refund.manage'], platformScope: false } }), access: async () => undefined };
  const service = new BillingRefundsService({ client: tx } as never, { account: async () => account, stripe } as never, admin as never, {} as never, db.lifecycle as never);
  // The staleness gate is the real one only for a request past its `expiresAt` (its first line refuses it); `again` is one more pass of the worker over the same row.
  const current = service['current'].bind(service), again = () => service['execute'](op as never);
  Object.assign(service, { logger: { warn: (line: unknown) => logged.push(line) }, actors: async () => undefined, current: async (row: any, inner: never) => row.expiresAt <= new Date() ? current(row, inner) : account });
  armed = true; await again();
  return { op, db, logged, calls, answers, again, view: () => service['view']({ userId: 'admin' } as never, op as never) };
}
const providerAnswer = (status: number, code?: string, type = 'invalid_request_error') =>
  new StripeRequestError(status >= 500 ? 'UNKNOWN' : status === 429 ? 'RETRY' : 'REJECTED', status === 429 ? 'rate_limited' : status >= 500 ? 'unavailable' : 'request_rejected', 60, code, type, status);

test('a provider rejection of the refund run is journaled and logged as the provider\'s own code and type, and read back only while the request has an error', async () => {
  const dispatched = { submittedCredentialVersion: 'v1', dispatchedAt: new Date(Date.now() - 600_000).toISOString(), providerKey: 'billing-refund-refund', paramsHash: 'hash' };
  const run = (error: Error) => refundRun(error, 'GET /invoices/in_1', dispatched); // the first read inside the run's `try`

  const rejected = await run(new StripeRequestError('REJECTED', 'request_rejected', 60, 'balance_insufficient', 'invalid_request_error'));
  assert.deepEqual([rejected.op.state, rejected.op.errorCode], ['UNKNOWN', 'CONTROL_REFUND_PROVIDER_UNAVAILABLE'], 'the state logic is the one it was');
  const { at, ...providerError } = rejected.op.resultJson.providerError;
  assert.deepEqual(providerError, { outcome: 'REJECTED', code: 'balance_insufficient', type: 'invalid_request_error' });
  assert.ok(Number.isFinite(Date.parse(at)), 'when the provider said no');
  assert.deepEqual({ ...rejected.op.resultJson, providerError: undefined }, { ...dispatched, providerError: undefined }, 'the rest of the journal is kept');
  assert.deepEqual(rejected.logged, [{ msg: 'billing.refund.provider_rejected', operationId: 'refund', outcome: 'REJECTED', providerCode: 'balance_insufficient', providerType: 'invalid_request_error' }], 'one line, nothing of the response');
  const shown = await rejected.view();
  assert.deepEqual([shown.providerErrorCode, shown.providerErrorType], ['balance_insufficient', 'invalid_request_error']);
  rejected.op.errorCode = null; // a later retry went through: nothing is left to explain
  const settled = await rejected.view();
  assert.deepEqual([settled.providerErrorCode, settled.providerErrorType], [null, null]);

  // A provider that gave no usable code still leaves its outcome, and anything that is not a provider error leaves the journal as it was.
  const bare = await run(new StripeRequestError('UNKNOWN', 'unavailable'));
  assert.deepEqual([bare.op.resultJson.providerError.outcome, bare.op.resultJson.providerError.code, bare.op.resultJson.providerError.type], ['UNKNOWN', null, null]);
  assert.deepEqual([bare.logged.length, (await bare.view()).providerErrorCode], [1, null]);
  const other = await run(new Error('boom'));
  assert.deepEqual([other.op.errorCode, other.op.resultJson, other.logged], ['CONTROL_REFUND_REVIEW', dispatched, []]);
  assert.deepEqual([(await other.view()).providerErrorCode, (await other.view()).providerErrorType], [null, null]);
});

test('a 400 or 402 answer to the credit-note create itself ends the refund request; every other failure waits as before', async () => {
  const approved = { submittedCredentialVersion: 'v1' };
  const audited = (r: Awaited<ReturnType<typeof refundRun>>) => r.db.audits.map(a => String(a.action)).filter(action => action.startsWith('billing.refund.')).map(action => action.slice(15));
  const reviews = (r: Awaited<ReturnType<typeof refundRun>>) => r.db.issues.map(issue => [issue.kind, issue.referenceId, issue.state]);

  // UAT 2026-10-10: a PromptPay refund answered 400 invalid_request_error with no code ("Cannot send email …").
  for (const error of [providerAnswer(400), providerAnswer(402, 'charge_already_refunded')]) {
    const r = await refundRun(error, 'POST /credit_notes', approved);
    assert.equal(r.calls.at(-1), 'POST /credit_notes', 'the create was reached and nothing was read after its refusal');
    assert.deepEqual([r.op.state, r.op.errorCode, r.op.leaseToken, r.op.observedAt], ['FAILED', 'CONTROL_REFUND_PROVIDER_REJECTED', null, null]);
    // pendingRefund (billing-refund-source.ts) holds a company on QUEUED/RUNNING/UNKNOWN/BLOCKED rows whose journal is not mutationResolved: this row is neither.
    assert.equal(r.op.resultJson.mutationResolved, true);
    assert.deepEqual([r.op.resultJson.providerError.outcome, r.op.resultJson.providerError.code, r.op.resultJson.providerError.type], ['REJECTED', error.providerCode ?? null, 'invalid_request_error']);
    assert.deepEqual([typeof r.op.resultJson.dispatchedAt, r.op.resultJson.providerKey, r.op.resultJson.creditNoteId], ['string', 'billing-refund-refund', undefined], 'the dispatch stays on record, with no note');
    assert.deepEqual(reviews(r), [['CONTROL_OPERATION_REVIEW', 'refund', 'OPEN']]);
    assert.deepEqual(audited(r), ['dispatch', 'rejected']);
    assert.deepEqual([r.db.lifecycle.calls, r.db.writes.filter(write => !/^(auditLog|billingIssue)\./.test(write))], [[], []], 'the package this refund asked to end is untouched');
    const view = await r.view();
    assert.equal(view.paymentMethod, 'promptpay', 'the invoice was bought with PromptPay');
    assert.deepEqual([view.state, view.errorCode, view.providerErrorType, view.allowedActions], ['FAILED', 'CONTROL_REFUND_PROVIDER_REJECTED', 'invalid_request_error', []], 'nothing left to run: the same request would be refused again');
  }

  // A retry of a create whose first answer was lost: no note carries this request, the same key is sent again, and a 400 now is the provider's answer to that create.
  const retried = await refundRun(providerAnswer(400), 'POST /credit_notes', { ...approved, dispatchedAt: new Date(Date.now() - 3_600_000).toISOString(), providerKey: 'billing-refund-refund', paramsHash: undefined });
  assert.deepEqual([retried.op.state, retried.op.errorCode, retried.op.resultJson.mutationResolved, audited(retried)], ['UNKNOWN', 'CONTROL_REFUND_SOURCE_CHANGED', undefined, ['review']], 'a journal that does not match the request is never sent again');
  const paramsHash = configurationHash(retried.op.proposedJson.params);
  const replayed = await refundRun(providerAnswer(400), 'POST /credit_notes', { ...approved, dispatchedAt: new Date(Date.now() - 3_600_000).toISOString(), providerKey: 'billing-refund-refund', paramsHash });
  assert.deepEqual([replayed.op.state, replayed.op.errorCode, replayed.op.resultJson.mutationResolved, audited(replayed)], ['FAILED', 'CONTROL_REFUND_PROVIDER_REJECTED', true, ['redispatch', 'rejected']]);

  // Not definite: the key is still in use (409), the key was used with other parameters, a rate limit, a server failure, no answer, no permission, not found.
  const unsure: Error[] = [providerAnswer(409), providerAnswer(400, undefined, 'idempotency_error'), providerAnswer(429), providerAnswer(500), new StripeRequestError('UNKNOWN', 'transport_unknown'),
    providerAnswer(401), providerAnswer(403), providerAnswer(404), new StripeRequestError('REJECTED', 'configuration_unavailable')];
  for (const error of unsure) {
    const r = await refundRun(error, 'POST /credit_notes', approved);
    assert.equal(r.calls.at(-1), 'POST /credit_notes');
    assert.deepEqual([r.op.state, r.op.errorCode, r.op.resultJson.mutationResolved, r.op.scheduledFor > new Date()], ['UNKNOWN', 'CONTROL_REFUND_PROVIDER_UNAVAILABLE', undefined, true], error.message);
    assert.deepEqual([audited(r), reviews(r), (await r.view()).allowedActions], [['dispatch', 'review'], [['CONTROL_OPERATION_REVIEW', 'refund', 'OPEN']], ['run']]);
  }

  // The same 400 from a read is no answer to the create: before the dispatch nothing was sent (BLOCKED), after it the outcome is unknown.
  const before = await refundRun(providerAnswer(400), 'GET /charges/ch_1', approved);
  assert.deepEqual([before.op.state, before.op.errorCode, before.op.resultJson.mutationResolved, before.calls.includes('POST /credit_notes')], ['BLOCKED', 'CONTROL_REFUND_PROVIDER_UNAVAILABLE', undefined, false]);
  const after = await refundRun(providerAnswer(400), 'GET /invoices/in_1', approved, 2);
  assert.deepEqual([after.op.state, after.op.errorCode, after.op.resultJson.mutationResolved, after.calls.includes('POST /credit_notes')], ['UNKNOWN', 'CONTROL_REFUND_PROVIDER_UNAVAILABLE', undefined, true]);
});

test('a dispatched refund request the provider never created ends an hour after its expiry; a create that did land is still found', async () => {
  const audited = (r: Awaited<ReturnType<typeof refundRun>>) => r.db.audits.map(a => String(a.action)).filter(action => action.startsWith('billing.refund.')).map(action => action.slice(15));
  const posts = (r: Awaited<ReturnType<typeof refundRun>>) => r.calls.filter(call => call === 'POST /credit_notes').length;
  const lost = async () => { // the create answered 500: nobody knows whether the provider made the note
    const r = await refundRun(providerAnswer(500), 'POST /credit_notes', { submittedCredentialVersion: 'v1' });
    assert.deepEqual([r.op.state, r.op.errorCode, posts(r)], ['UNKNOWN', 'CONTROL_REFUND_PROVIDER_UNAVAILABLE', 1]);
    return r;
  };

  // Past the ten minutes but not yet an hour past them: nothing is sent again, and the request still waits.
  const r = await lost();
  r.op.expiresAt = new Date(Date.now() - 3_540_000); await r.again();
  assert.deepEqual([r.op.state, r.op.errorCode, r.op.resultJson.mutationResolved, posts(r), (await r.view()).allowedActions], ['UNKNOWN', 'CONTROL_PREVIEW_STALE', undefined, 1, ['run']]);

  // An hour past them, and the provider's complete list of the invoice's credit notes has none of this request: it ends, with nothing sent.
  r.op.expiresAt = new Date(Date.now() - 3_600_000); await r.again();
  assert.deepEqual([r.op.state, r.op.errorCode, r.op.leaseToken, r.op.observedAt, posts(r)], ['FAILED', 'CONTROL_REFUND_NOT_CREATED', null, null, 1]);
  // pendingRefund (billing-refund-source.ts) holds a company on QUEUED/RUNNING/UNKNOWN/BLOCKED rows whose journal is not mutationResolved: this row is neither.
  assert.deepEqual([r.op.resultJson.mutationResolved, typeof r.op.resultJson.dispatchedAt, r.op.resultJson.creditNoteId, r.op.resultJson.providerError.outcome], [true, 'string', undefined, 'UNKNOWN'], 'the dispatch and the lost answer stay on record');
  assert.deepEqual(audited(r), ['dispatch', 'review', 'review', 'not_created']);
  assert.deepEqual(r.db.issues.map(issue => [issue.kind, issue.referenceId, issue.state]), [['CONTROL_OPERATION_REVIEW', 'refund', 'OPEN']]);
  assert.deepEqual([r.db.lifecycle.calls, r.db.writes.filter(write => !/^(auditLog|billingIssue)\./.test(write))], [[], []], 'the package this refund asked to end is untouched');
  const view = await r.view();
  assert.deepEqual([view.state, view.errorCode, view.allowedActions], ['FAILED', 'CONTROL_REFUND_NOT_CREATED', []], 'nothing left to run: staff start a new request');

  // The same hour later, but the create had landed although we saw an error: the note is found first and the request takes the observed path.
  const landed = await lost(), p = landed.op.proposedJson, created = Math.floor(Date.now() / 1000);
  const refund = { id: 'pyr_1', object: 'refund', livemode: true, charge: 'ch_1', currency: 'thb', amount: p.amountSatang, created, status: 'pending' };
  landed.answers['GET /credit_notes'] = () => ({ object: 'list', has_more: false, data: [{ ...landed.answers['GET /credit_notes/preview']!(p.params) as object, id: 'cn_1', number: 'CN-1', created,
    metadata: p.params.metadata, refunds: [{ refund: 'pyr_1', amount_refunded: p.amountSatang }] }] });
  landed.answers['GET /refunds'] = () => ({ object: 'list', has_more: false, data: [refund] }); landed.answers['GET /refunds/pyr_1'] = () => refund;
  landed.op.expiresAt = new Date(Date.now() - 86_400_000); await landed.again();
  assert.deepEqual([landed.op.state, landed.op.errorCode, landed.op.resultJson.mutationResolved, landed.op.resultJson.creditNoteId, landed.op.resultJson.refundState, posts(landed)], ['QUEUED', null, true, 'cn_1', 'pending', 1]);
  assert.deepEqual(audited(landed), ['dispatch', 'review', 'observed']);

  // Never dispatched: nothing was ever sent, so an expired request is blocked for a fresh review as before, however old it is.
  const unsent = await refundRun(providerAnswer(500), 'GET /charges/ch_1', { submittedCredentialVersion: 'v1' });
  unsent.op.expiresAt = new Date(Date.now() - 86_400_000); await unsent.again();
  assert.deepEqual([unsent.op.state, unsent.op.errorCode, unsent.op.resultJson.mutationResolved, posts(unsent), audited(unsent)], ['BLOCKED', 'CONTROL_PREVIEW_STALE', undefined, 0, ['review', 'review']]);
  assert.deepEqual((await unsent.view()).allowedActions, ['cancel', 'run']);
});
