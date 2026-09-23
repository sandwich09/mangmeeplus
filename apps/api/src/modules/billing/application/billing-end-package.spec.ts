import assert from 'node:assert/strict';
import { test } from 'node:test';
import { termProjectionHash } from '../domain/paid-invoice';
import { endPackageBlock, endPaidPackage, refundEndsPackage } from './billing-end-package';
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

/** In-memory Prisma transaction: enough rows for the end-package and applied-invoice paths, every write recorded. */
function fakeDb(rows: { company?: Record<string, unknown>; account?: Record<string, unknown>; invoice?: Record<string, unknown> } = {}) {
  const state = { company: { id: 'company', status: 'ACTIVE', planTerm: term(), ...rows.company }, account: account(rows.account), invoice: invoice(rows.invoice) };
  const writes: string[] = [];
  const tx: never = new Proxy({} as Record<string, unknown>, { get: (_, model: string) => {
    if (model === '$executeRaw' || model === '$queryRaw') return async () => [];
    if (model === '$transaction') return (fn: (inner: unknown) => unknown) => fn(tx);
    return new Proxy({}, { get: (_, method: string) => async (args: { data?: Record<string, unknown>; where?: Record<string, unknown> } = {}) => {
      if (/^(create|update|upsert|delete)/.test(method)) writes.push(`${model}.${method}`);
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
  return { state, writes, tx, lifecycle };
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

test('refund terminal step: SUCCEEDED with the choice ends it; failed, pending and default leave the package', async () => {
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

test('standalone end requires a full refund and the current-term invoice, behind the password proof', async () => {
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
