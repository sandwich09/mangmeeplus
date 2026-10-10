/**
 * D-P5-6 — the two pure halves of `SCHEDULE_PRICE_RETURN`: the exact write that reaches Stripe,
 * and the shapes that count as "the shop is back on the catalog price".
 *
 * `observed()` is the operation's only definition of done, so what it REFUSES matters more than
 * what it accepts: every refusal here is a subscription this platform would otherwise call
 * returned while the customer is still being charged the deal price, or while the cycle they
 * already paid for has moved.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BillingPriceReturn, priceReturnObserved, priceReturnParams, type PriceReturnProposed } from './billing-price-return';
import type { BillingSnapshot } from './billing.service';

const CATALOG = 'price_catalog', DEAL = 'price_deal', ITEM = 'si_1', SUB = 'sub_1';
const RETURN_AT = '2026-12-31T10:00:00.000Z', target = Date.parse(RETURN_AT) / 1000;

const proposed: PriceReturnProposed = {
  accountId: 'acct_1', dealRequestId: 'deal_1', subscriptionId: SUB, subscriptionItemId: ITEM,
  paidThrough: RETURN_AT, sourceHash: 'hash', sourceTermHash: 'term',
  dealPriceId: DEAL, params: {},
  snapshot: { priceId: CATALOG, policy: { taxRateId: 'txr_1' } } as unknown as BillingSnapshot,
};

const sub = (over: Record<string, unknown> = {}, item: Record<string, unknown> = {}) => ({
  id: SUB, status: 'active', billing_mode: { type: 'classic' }, collection_method: 'charge_automatically',
  items: { has_more: false, data: [{ id: ITEM, price: CATALOG, quantity: 1, tax_rates: [{ id: 'txr_1' }],
    current_period_end: target, ...item }] },
  ...over,
});

test('the write swaps the price and touches nothing else (D-P5-6)', () => {
  assert.deepEqual(priceReturnParams({ itemId: ITEM, catalogPriceId: CATALOG, taxRateId: 'txr_1' }), {
    // The cycle the customer already paid for must not be re-priced, credited or re-invoiced.
    proration_behavior: 'none',
    // A swap that silently needs a new payment is a failure, not a subscription in limbo.
    payment_behavior: 'error_if_incomplete',
    items: [{ id: ITEM, price: CATALOG, quantity: 1, tax_rates: ['txr_1'] }],
  });
  // No VAT registration, no tax rate on the line — not an empty array Stripe would read as "clear".
  assert.deepEqual(priceReturnParams({ itemId: ITEM, catalogPriceId: CATALOG, taxRateId: null }),
    { proration_behavior: 'none', payment_behavior: 'error_if_incomplete',
      items: [{ id: ITEM, price: CATALOG, quantity: 1 }] });
});

test('"returned" means the catalog price bills the NEXT cycle, and this one is untouched', () => {
  assert.equal(priceReturnObserved(proposed, sub()), true);

  // Still on the deal price: the whole point of the operation has not happened.
  assert.equal(priceReturnObserved(proposed, sub({}, { price: DEAL })), false);
  // The boundary moved, so the customer paid for a period that no longer exists.
  assert.equal(priceReturnObserved(proposed, sub({}, { current_period_end: target + 86400 })), false);
  // A schedule appeared underneath us; its phases, not this item, decide what bills next.
  assert.equal(priceReturnObserved(proposed, sub({ schedule: 'sub_sched_1' })), false);
  // Someone cancelled instead: there is no next cycle to return to.
  assert.equal(priceReturnObserved(proposed, sub({ cancel_at_period_end: true })), false);
  assert.equal(priceReturnObserved(proposed, sub({ cancel_at: target })), false);
  assert.equal(priceReturnObserved(proposed, sub({ status: 'canceled' })), false);
  // Collection was paused or a pending update is queued: the next invoice is not ours to predict.
  assert.equal(priceReturnObserved(proposed, sub({ pause_collection: { behavior: 'void' } })), false);
  assert.equal(priceReturnObserved(proposed, sub({ pending_update: {} })), false);
  // A discount, a second item or a quantity change would make the invoice something else entirely.
  assert.equal(priceReturnObserved(proposed, sub({}, { discounts: [{ id: 'di_1' }] })), false);
  assert.equal(priceReturnObserved(proposed, sub({}, { quantity: 2 })), false);
  assert.equal(priceReturnObserved(proposed, sub({ items: { has_more: true, data: [] } })), false);
  // Tax drifted off the line the policy says every paid line carries.
  assert.equal(priceReturnObserved(proposed, sub({}, { tax_rates: [] })), false);
  assert.equal(priceReturnObserved(proposed, sub({}, { tax_rates: [{ id: 'txr_other' }] })), false);
  // A different subscription or item id is a mapping mistake, never a success.
  assert.equal(priceReturnObserved(proposed, sub({ id: 'sub_2' })), false);
  assert.equal(priceReturnObserved(proposed, sub({}, { id: 'si_2' })), false);
  // Invoiced by hand rather than charged: a QR-billed subscription has no card cycle to swap.
  assert.equal(priceReturnObserved(proposed, sub({ collection_method: 'send_invoice' })), false);
});

// 2026-10-10: a price return holds the shop's slot, so it ends from a provider read instead of waiting for ever.
function pass(row: Record<string, unknown>, live: Record<string, unknown> | Error) {
  const past = new Date(Date.now() - 86400_000);
  const account = { id: 'acct_1', companyId: 'company', stripeAccountId: 'acct_stripe', livemode: false, customerId: 'cus_1', baseSubscriptionId: SUB,
    activeCollectionOperationId: 'op_1', paidThrough: past, leaseToken: 'lease', leaseUntil: new Date(Date.now() + 60_000) };
  const op = { id: 'op_1', expiresAt: past, proposedJson: { ...proposed, paidThrough: past.toISOString() }, ...row };
  const writes: string[] = [], sent: unknown[][] = [];
  const operation = async (input: any) => { if (input.data.state) writes.push(`operation:${input.data.state}:${input.data.errorCode}`); return op; };
  const release = async (input: any) => { if (input.data.activeCollectionOperationId === null) writes.push('release'); return account; };
  const tx = { $queryRaw: async () => [], billingAccount: { findUniqueOrThrow: async () => account, update: release },
    billingOperation: { findFirstOrThrow: async () => op, update: operation },
    billingIssue: { updateMany: async () => ({ count: 0 }) }, auditLog: { create: async (input: any) => { writes.push(input.data.action); } } };
  const prisma = { client: { ...tx, $transaction: async (fn: (client: unknown) => unknown) => fn(tx) } };
  const stripe = { assertAccount: async () => undefined, list: async () => [], request: async (...args: unknown[]) => {
    if (args[0] !== 'GET') { sent.push(args); throw new Error('nothing may be sent'); }
    if (live instanceof Error) throw live;
    return { object: 'subscription', customer: 'cus_1', livemode: false, metadata: { billingAccountId: 'acct_1' }, ...live }; } };
  const issues: string[] = [];
  const service = new BillingPriceReturn(prisma as any, stripe as any, { issue: async (_: string, kind: string) => { issues.push(kind); } } as any);
  return { writes, sent, issues, run: () => service.advance(account as any, 'lease') };
}
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const ENDED = ['operation:FAILED:SPECIAL_PRICE_RETURN_NOT_APPLIED', 'release', 'billing.price_return.ended'];

test('a price return never sent ends at once and releases the account (R-D)', async () => {
  // Refused before any provider write by an earlier build: no pass would ever send it.
  const blocked = pass({ state: 'BLOCKED', errorCode: 'SPECIAL_PRICE_RETURN_REVIEW', resultJson: null }, sub({}, { price: DEAL }));
  await blocked.run();
  assert.deepEqual([blocked.writes, blocked.sent.length], [ENDED, 0]);
  // Refused now, before the write (the provider read failed): the same transaction ends it, the review case stays.
  const queued = pass({ state: 'QUEUED', errorCode: null, resultJson: null }, new Error('unavailable'));
  await queued.run();
  assert.deepEqual([queued.writes, queued.sent.length, queued.issues], [ENDED, 0, ['SPECIAL_PRICE_RETURN_REVIEW']]);
});

test('a price return sent and not applied ends from the provider read after the re-send window and the quiet margin (R-B)', async () => {
  const started = (minutes: number, live: Record<string, unknown> | Error) =>
    pass({ state: 'UNKNOWN', errorCode: 'SPECIAL_PRICE_RETURN_REVIEW', resultJson: { startedAt: ago(minutes), updateStartedAt: ago(minutes) } }, live);
  // One hour ten after the first send, the subscription still bills the deal price: over, nothing sent.
  const over = started(71, sub({}, { price: DEAL }));
  await over.run();
  assert.deepEqual([over.writes, over.sent.length], [ENDED, 0]);
  // Inside the quiet margin a pass only reads; a failed read at any age only waits (R-A).
  for (const waiting of [started(65, sub({}, { price: DEAL })), started(600, new Error('unavailable'))]) {
    await waiting.run();
    assert.deepEqual([waiting.writes, waiting.sent.length], [['operation:UNKNOWN:SPECIAL_PRICE_RETURN_REVIEW'], 0]);
  }
  // Neither the deal price nor the returned shape: the read does not show "not applied", so it keeps waiting in review.
  const other = started(600, sub({}, { price: 'price_other' }));
  await other.run();
  assert.deepEqual(other.writes, ['operation:UNKNOWN:SPECIAL_PRICE_RETURN_REVIEW']);
});

// 2026-10-10: a return that ended failed is queued again by the sweep, a new row once a day, until it succeeds.
function retry(input: { failed?: Record<string, unknown>; account?: Record<string, unknown>; live?: Record<string, unknown>; item?: Record<string, unknown> } = {}) {
  const boundary = new Date(Date.now() + 86400_000 - (Date.now() % 1000)), at = boundary.getTime() / 1000;
  const account: Record<string, any> = { id: 'acct_1', companyId: 'company', stripeAccountId: 'acct_stripe', livemode: false, customerId: 'cus_1', baseSubscriptionId: SUB,
    renewalMode: 'CARD_AUTO', subscriptionState: 'active', paidThrough: boundary, version: 7, termProjectionHash: 'term', ...input.account };
  const deal = { id: 'deal_1', companyId: 'company', offerSnapshotJson: {}, returnAt: boundary };
  const failed: Record<string, any> = { id: 'op_1', type: 'SCHEDULE_PRICE_RETURN', state: 'FAILED', errorCode: 'SPECIAL_PRICE_RETURN_NOT_APPLIED', referenceId: 'deal_1', companyId: 'company',
    idempotencyKey: `deal-return:deal_1:${boundary.toISOString()}`, observedAt: new Date(Date.now() - 25 * 3600_000), scheduledFor: null,
    proposedJson: { ...proposed, paidThrough: boundary.toISOString() }, ...input.failed };
  const created: Record<string, any>[] = [], sent: unknown[][] = [];
  const operations = () => [failed, ...created];
  const tx = { $queryRaw: async () => [], auditLog: { create: async () => ({}) },
    billingAccount: { findUniqueOrThrow: async () => account, update: async (args: any) => Object.assign(account, { activeCollectionOperationId: args.data.activeCollectionOperationId }) },
    packageChangeRequest: { findMany: async () => [deal], findFirst: async () => deal },
    billingOperation: {
      findFirst: async (args: any) => operations().find(row => !(args.where.state?.notIn ?? []).includes(row.state)) ?? null,
      findMany: async (args: any) => operations().filter(row => row.state === args.where.state && (!args.where.errorCode || row.errorCode === args.where.errorCode) &&
        (!row.scheduledFor || row.scheduledFor <= new Date()) && row.observedAt <= args.where.observedAt.lte),
      count: async () => operations().length,
      update: async (args: any) => Object.assign(operations().find(row => row.id === args.where.id)!, args.data),
      create: async (args: any) => { if (operations().some(row => row.idempotencyKey === args.data.idempotencyKey)) throw new Error('P2002 unique idempotencyKey');
        const row = { id: `op_${operations().length + 1}`, ...args.data }; created.push(row); return row; } } };
  const prisma = { client: { ...tx, $transaction: async (fn: (client: unknown) => unknown) => fn(tx) } };
  const stripe = { enabled: true, accountId: 'acct_stripe', livemode: false, assertAccount: async () => undefined, list: async () => [], request: async (...args: unknown[]) => {
    if (args[0] !== 'GET') { sent.push(args); throw new Error('the sweep sends nothing'); }
    if (String(args[1]).startsWith('/subscription_schedules/')) return { id: 'sub_sched_1', object: 'subscription_schedule', customer: 'cus_1', subscription: SUB, livemode: false };
    return { object: 'subscription', customer: 'cus_1', livemode: false, metadata: { billingAccountId: 'acct_1' }, ...sub(input.live, { price: DEAL, current_period_end: at, ...input.item }) }; } };
  const service = new BillingPriceReturn(prisma as any, stripe as any, { account: async () => account, assertTaxSettings: async () => undefined } as any);
  (service as any).catalogSnapshot = async () => proposed.snapshot;
  return { service, account, failed, created, sent };
}

test('a failed price return is queued again as a new row, at most once a day', async () => {
  const again = retry();
  assert.deepEqual(await again.service.sweep(), { queued: 1 });
  // A new row, so a new provider idempotency key; the failed one is replaced and its review case stays open.
  assert.deepEqual([again.created.length, again.created[0]!.idempotencyKey, again.created[0]!.state, again.failed.state, again.account.activeCollectionOperationId, again.sent.length],
    [1, `${again.failed.idempotencyKey}:2`, 'QUEUED', 'SUPERSEDED', again.created[0]!.id, 0]);
  // While that attempt is in flight, and within 24 hours of the last attempt's end, nothing more is queued.
  assert.deepEqual(await again.service.sweep(), { queued: 0 });
  assert.deepEqual(await retry({ failed: { observedAt: new Date(Date.now() - 23 * 3600_000) } }).service.sweep(), { queued: 0 });
});

test('a retry writes no row when the account is not ready or the subscription is not the one that failed, and never after a provider refusal', async () => {
  const waits = [
    retry({ account: { activeAttemptId: 'attempt_1' } }), retry({ account: { activeCollectionOperationId: 'op_shop' } }),
    retry({ account: { paidThrough: new Date(Date.now() + 3600_000) } }), retry({ live: { cancel_at_period_end: true } }),
    retry({ live: { schedule: 'sub_sched_1' } }), retry({ item: { id: 'si_2' } }), retry({ item: { price: 'price_other' } }),
  ];
  for (const wait of waits) {
    assert.deepEqual([await wait.service.sweep(), wait.created.length, wait.failed.state], [{ queued: 0 }, 0, 'FAILED']);
    // Looked at again tomorrow, not on every 15-minute tick.
    assert.ok(wait.failed.scheduledFor > new Date(Date.now() + 23 * 3600_000), `case ${waits.indexOf(wait)}`);
    assert.deepEqual(await wait.service.sweep(), { queued: 0 });
  }
  const refused = retry({ failed: { errorCode: 'SPECIAL_PRICE_RETURN_REJECTED' } });
  assert.deepEqual([await refused.service.sweep(), refused.failed.scheduledFor], [{ queued: 0 }, null]);
  // Already on the catalog price: an attempt is queued so that `advance` records it from the read, without sending.
  const done = retry({ item: { price: CATALOG } });
  assert.deepEqual([await done.service.sweep(), done.created[0]!.proposedJson.dealPriceId, done.sent.length], [{ queued: 1 }, DEAL, 0]);
});

test('a return the provider itself refused ends under its own code, which the sweep never retries', async () => {
  const refused = pass({ state: 'UNKNOWN', errorCode: 'SPECIAL_PRICE_RETURN_REVIEW', resultJson: { startedAt: ago(71), rejected: 'resource_missing' } }, sub({}, { price: DEAL }));
  await refused.run();
  assert.deepEqual([refused.writes[0], refused.sent.length], ['operation:FAILED:SPECIAL_PRICE_RETURN_REJECTED', 0]);
});
