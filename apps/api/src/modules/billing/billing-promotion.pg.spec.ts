/**
 * Promotion campaigns against real PostgreSQL (docs/plans/starter-249-bonus-month-promotion-plan.md §3, §5; spec §5–§6;
 * A03, A04, A15, A31, A36). A release gate: it writes and reads every column and CHECK that
 * `20261009120000_billing_promotion_campaigns` adds, and proves reserve → consume → apply, once per company per campaign
 * per environment, release and re-reserve on one row, the cap under the fence with two racing transactions, every
 * admission refusal on the database clock, the base + bonus receipt lots, and the bonus-first draw on an equal expiry.
 *
 * Run with:
 *   BILLING_PROMOTION_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/billing-promotion.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { BILLING_DRAFT_POLICY, billingOffer, type BillingPolicy, type BillingPromotionCampaign, type BillingPromotionSnapshot } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import { consumePromotion, lockPromotionFence, markPromotionApplied, promotionEligibility, promotionEnvironment, promotionForAttempt, promotionForInvoice,
  promotionOffers, promotionUsage, releasePromotion, reservePromotion } from './application/billing-promotion';
import { grantPaidPackageReceipts, grantPromotionPackageReceipts, paidReceiptBalance, promotionReceiptSourceKey, promotionSegments, receiptLots,
  visibleReceiptLots } from './application/billing-receipt-grants';
import { appendPackageInterval, promotionBoundaries } from './domain/billing-package';
import { promotionOfferSignature } from './domain/billing-promotion';

const databaseUrl = process.env.BILLING_PROMOTION_TEST_DATABASE_URL;
const tax = BILLING_DRAFT_POLICY.taxTreatment, HOUR = 3_600_000;
type Shop = { companyId: string; accountId: string };

describe('promotion campaigns on PostgreSQL', { skip: !databaseUrl }, () => {
  let client: PrismaClient;
  const run = randomUUID().replaceAll('-', '').slice(0, 12), stripeAccountId = `acct_${run}`, companyIds: string[] = [];
  let sequence = 0;
  before(() => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_ci'), 'only a disposable local *_ci database');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  });
  after(async () => {
    const where = { companyId: { in: companyIds } };
    await client.billingPromotionRedemption.deleteMany({ where });
    await client.billingReceiptGrant.deleteMany({ where }); // the ledger cascades with its lots
    await client.companyPlanTerm.deleteMany({ where });
    await client.billingAccount.deleteMany({ where });
    await client.company.deleteMany({ where: { id: { in: companyIds } } });
    await client.billingSettings.deleteMany({ where: { stripeAccountId } });
    await client.billingPolicyRevision.deleteMany({ where: { stripeAccountId } });
    await client.$disconnect();
  });

  const month = (policy: BillingPolicy = BILLING_DRAFT_POLICY) => billingOffer('STARTER_249', 'month', policy);
  const year = billingOffer('STARTER_249', 'year');
  /** A campaign open now on the real clock: the reservation reads the database's, never a caller's. */
  const campaign = (over: Partial<BillingPromotionCampaign> = {}): BillingPromotionCampaign => ({ campaignId: `promo-${run}-${sequence += 1}`, type: 'BONUS_MONTHS', revision: 1,
    internalName: 'Synthetic', description: null, displayName: 'ซื้อ 1 เดือน ฟรี 1 เดือน', startsAt: new Date(Date.now() - HOUR).toISOString(),
    endsAt: new Date(Date.now() + HOUR).toISOString(), cap: null, paused: false, endedAt: null, rules: [
      { offerKey: 'STARTER_249', interval: 'month', bonusMonths: 1, bonusReceiptUnits: 30, offerSignature: promotionOfferSignature(month(), tax) },
      { offerKey: 'STARTER_249', interval: 'year', bonusMonths: 1, bonusReceiptUnits: 30, offerSignature: promotionOfferSignature(year, tax) }], ...over });
  /** Publishes a new ACTIVE revision of one mode: the policy plus exactly these campaigns. Returns what `settings()` would. */
  async function publish(campaigns: BillingPromotionCampaign[], livemode = false, policy: BillingPolicy = BILLING_DRAFT_POLICY) {
    const promotions = Object.fromEntries(campaigns.map(item => [item.campaignId, item]));
    const revision = await client.billingPolicyRevision.create({ data: { stripeAccountId, livemode, version: sequence += 1, state: 'ACTIVE', policyJson: policy,
      promotionJson: promotions, createdByUserId: `admin-${run}` } });
    const id = `${stripeAccountId}:${livemode ? 'live' : 'test'}`;
    await client.billingSettings.upsert({ where: { id }, create: { id, stripeAccountId, livemode, gatesJson: {}, policyRevisionId: revision.id }, update: { policyRevisionId: revision.id } });
    return { settings: { livemode }, promotions, revisionId: revision.id };
  }
  async function shop(livemode = false, companyId = `promo-shop-${run}-${sequence += 1}`): Promise<Shop> {
    if (!companyIds.includes(companyId)) { companyIds.push(companyId); await client.company.create({ data: { id: companyId, name: 'Synthetic promotion company' } }); }
    const account = await client.billingAccount.create({ data: { companyId, stripeAccountId, livemode } });
    return { companyId, accountId: account.id };
  }
  const snapshot = async (state: Awaited<ReturnType<typeof publish>>, s: Shop, offer = month(), campaignId?: string): Promise<BillingPromotionSnapshot> => {
    const result = await promotionEligibility(client, { settings: state, companyId: s.companyId, campaignId, offer, tax, now: new Date() });
    assert.ok(result.ok, JSON.stringify(result));
    return result.snapshot;
  };
  /** Checkout's order: the fence first, then the reservation, in one transaction. `hold` keeps it open to overlap another. */
  const reserve = (s: Shop, pinned: BillingPromotionSnapshot, attemptId: string, livemode = false, hold = 0) => client.$transaction(async tx => {
    await lockPromotionFence(tx, promotionEnvironment(livemode));
    const result = await reservePromotion(tx, { snapshot: pinned, stripeAccountId, livemode, billingAccountId: s.accountId, companyId: s.companyId, attemptId,
      policyRevisionId: 'attempt-revision', now: new Date(0) });
    if (hold) await new Promise(resolve => setTimeout(resolve, hold));
    return result;
  });
  const row = (s: Shop, campaignId: string, env: 'TEST' | 'LIVE' = 'TEST') => client.billingPromotionRedemption.findUniqueOrThrow({
    where: { promotionEnvironmentId_campaignId_companyId: { promotionEnvironmentId: env, campaignId, companyId: s.companyId } } });
  const attempt = (name: string) => `attempt-${name}-${randomUUID()}`, invoice = (name: string) => `invoice-${name}-${randomUUID()}`;

  it('reserves at Checkout, is used once paid and stamped once applied (spec §6 RESERVED → CONSUMED → APPLY)', async () => {
    const live = campaign(), state = await publish([live]), s = await shop(), pinned = await snapshot(state, s), a = attempt('a'), i = invoice('a');
    assert.deepEqual({ ...pinned, termsHash: undefined, offerSignature: undefined }, { environmentId: 'TEST', campaignId: live.campaignId, revision: 1, termsHash: undefined,
      displayName: live.displayName, offerKey: 'STARTER_249', interval: 'month', offerSignature: undefined, bonusMonths: 1, bonusReceiptUnits: 30 });
    const started = Date.now();
    assert.equal(await reserve(s, pinned, a), true);
    const reserved = await row(s, live.campaignId);
    assert.deepEqual([reserved.state, reserved.attemptId, reserved.invoiceId, reserved.billingAccountId, reserved.stripeAccountId, reserved.livemode, reserved.policyRevisionId,
      reserved.campaignRevision, reserved.termsHash, reserved.offerKey, reserved.interval, reserved.offerSignature, reserved.bonusMonths, reserved.bonusReceiptUnits,
      reserved.releaseCount, reserved.version], ['RESERVED', a, null, s.accountId, stripeAccountId, false, 'attempt-revision', 1, pinned.termsHash, 'STARTER_249', 'month',
      pinned.offerSignature, 1, 30, 0, 0]);
    // The database clock, never the caller's `now` (1970 here); the first dispatch must start within 10 minutes.
    assert.ok(Math.abs(reserved.acceptedAt.getTime() - started) < 60_000);
    assert.equal(reserved.createBy.getTime() - reserved.acceptedAt.getTime(), 600_000);
    assert.deepEqual(await promotionUsage(client, 'TEST', live.campaignId), { reserved: 1, consumed: 0, taken: 1 });
    assert.equal((await promotionForAttempt(client, a))?.id, reserved.id);

    const paidAt = new Date();
    assert.equal(await consumePromotion(client, { attemptId: a, invoiceId: i, companyId: s.companyId, now: paidAt }), true);
    assert.equal(await consumePromotion(client, { attemptId: a, invoiceId: i, companyId: s.companyId, now: new Date() }), true, 'a replay of the same invoice agrees');
    assert.equal(await consumePromotion(client, { attemptId: a, invoiceId: invoice('other'), companyId: s.companyId, now: new Date() }), false, 'another invoice does not');
    assert.equal(await consumePromotion(client, { attemptId: a, invoiceId: i, companyId: 'another-company', now: new Date() }), false);
    const consumed = await row(s, live.campaignId);
    assert.deepEqual([consumed.state, consumed.invoiceId, consumed.consumedAt?.getTime(), consumed.benefitAppliedAt, consumed.version], ['CONSUMED', i, paidAt.getTime(), null, 1]);
    assert.deepEqual(await promotionUsage(client, 'TEST', live.campaignId), { reserved: 0, consumed: 1, taken: 1 }, 'RESERVED → CONSUMED does not change taken');
    await releasePromotion(client, a);
    assert.equal((await row(s, live.campaignId)).state, 'CONSUMED', 'a used right is never released');

    const { paidEnd, benefitEnd } = promotionBoundaries({ serviceStartsAt: paidAt, interval: 'month', bonusMonths: 1 }), appliedAt = new Date();
    await markPromotionApplied(client, { invoiceId: i, paidStart: paidAt, paidEnd, bonusEnd: benefitEnd, now: appliedAt });
    await markPromotionApplied(client, { invoiceId: i, paidStart: new Date(0), paidEnd: new Date(1), bonusEnd: new Date(2), now: new Date(appliedAt.getTime() + 5000) });
    const applied = await promotionForInvoice(client, i);
    assert.deepEqual([applied?.benefitAppliedAt?.getTime(), applied?.paidStart?.getTime(), applied?.paidEnd?.getTime(), applied?.bonusEnd?.getTime(), applied?.version],
      [appliedAt.getTime(), paidAt.getTime(), paidEnd.getTime(), benefitEnd.getTime(), 2], 'a replay changes nothing');
    await assert.rejects(markPromotionApplied(client, { invoiceId: invoice('none'), paidStart: paidAt, paidEnd, bonusEnd: benefitEnd, now: appliedAt }), /promotion_not_consumed/);

    // The package page: both rules of the campaign, their totals, and why this shop cannot take it again.
    const views = await promotionOffers(client, { settings: state, companyId: s.companyId, offers: [month(), year, billingOffer('BASIC_499', 'month')], tax, now: new Date() });
    assert.deepEqual(views.map(view => [view.campaignId, view.interval, view.totalMonths, view.totalReceiptUnits, view.endsAt, view.available, view.reason]),
      [[live.campaignId, 'month', 2, 60, live.endsAt, false, 'ALREADY_USED'], [live.campaignId, 'year', 13, 390, live.endsAt, false, 'ALREADY_USED']]);
    const other = await shop();
    assert.deepEqual((await promotionOffers(client, { settings: state, companyId: other.companyId, offers: [month()], tax, now: new Date() })).map(view => [view.available, view.reason]), [[true, null]]);
    // The raw CHECKs behind the seams.
    await assert.rejects(client.billingPromotionRedemption.update({ where: { id: consumed.id }, data: { state: 'CANCELLED' } }));
    await assert.rejects(client.billingPromotionRedemption.update({ where: { id: consumed.id }, data: { state: 'RELEASED' } }), 'RELEASED must hold no attempt or invoice');
    await assert.rejects(client.billingPromotionRedemption.update({ where: { id: consumed.id }, data: { promotionEnvironmentId: 'LIVE' } }), 'the environment equals livemode');
  });

  it('gives one right per company per campaign, whatever the interval; another campaign and the other environment are separate (A03)', async () => {
    const live = campaign(), next = campaign({ startsAt: new Date(Date.now() - 2 * HOUR).toISOString() }), state = await publish([live, next]);
    const s = await shop(), pinned = await snapshot(state, s, month(), live.campaignId), yearly = await snapshot(state, s, year, live.campaignId), a = attempt('a');
    assert.equal(await reserve(s, pinned, a), true);
    assert.equal(await reserve(s, pinned, a), true, 'a replay of the same attempt');
    assert.equal(await reserve(s, pinned, attempt('b')), 'IN_PROGRESS');
    assert.equal(await reserve(s, yearly, attempt('y')), 'IN_PROGRESS', 'the yearly rule is the same right');
    assert.deepEqual(await promotionEligibility(client, { settings: state, companyId: s.companyId, campaignId: live.campaignId, offer: year, tax, now: new Date() }), { ok: false, reason: 'IN_PROGRESS' });
    assert.equal(await consumePromotion(client, { attemptId: a, invoiceId: invoice('a'), companyId: s.companyId, now: new Date() }), true);
    assert.equal(await reserve(s, pinned, attempt('c')), 'ALREADY_USED');
    assert.equal(await reserve(s, yearly, attempt('d')), 'ALREADY_USED');
    assert.deepEqual(await promotionUsage(client, 'TEST', live.campaignId), { reserved: 0, consumed: 1, taken: 1 });
    // A different campaign is a different right; with no campaign named, the quote finds the one this shop can still take.
    const second = await snapshot(state, s);
    assert.equal(second.campaignId, next.campaignId);
    assert.equal(await reserve(s, second, attempt('e')), true);
    assert.deepEqual(await promotionEligibility(client, { settings: state, companyId: s.companyId, offer: month(), tax, now: new Date() }), { ok: false, reason: 'ALREADY_USED' });
    assert.deepEqual(await promotionEligibility(client, { settings: state, companyId: s.companyId, campaignId: 'unknown', offer: month(), tax, now: new Date() }), { ok: false, reason: 'CHANGED' });
    assert.deepEqual(await promotionEligibility(client, { settings: state, companyId: s.companyId, offer: billingOffer('PRO_999', 'month'), tax, now: new Date() }), { ok: false, reason: 'OFFER_NOT_COVERED' });
    // TEST and LIVE are separate namespaces; a TEST snapshot is never honoured in LIVE.
    const liveState = await publish([live], true), liveShop = await shop(true, s.companyId), livePinned = await snapshot(liveState, liveShop);
    assert.equal(livePinned.environmentId, 'LIVE');
    assert.equal(await reserve(liveShop, pinned, attempt('f'), true), 'CHANGED');
    assert.equal(await reserve(liveShop, livePinned, attempt('g'), true), true);
    assert.equal((await row(liveShop, live.campaignId, 'LIVE')).livemode, true);
    assert.deepEqual(await promotionUsage(client, 'LIVE', live.campaignId), { reserved: 1, consumed: 0, taken: 1 });
  });

  it('releases a proven-unpaid reservation and takes it again on the same row; the old attempt can no longer use it (A30)', async () => {
    const live = campaign({ cap: 1 }), state = await publish([live]), s = await shop(), pinned = await snapshot(state, s), old = attempt('old'), fresh = attempt('new');
    assert.equal(await reserve(s, pinned, old), true);
    const first = await row(s, live.campaignId);
    await releasePromotion(client, old);
    const released = await row(s, live.campaignId);
    assert.deepEqual([released.state, released.attemptId, released.invoiceId, released.releaseCount, released.version, released.releasedAt instanceof Date], ['RELEASED', null, null, 1, 1, true]);
    assert.deepEqual(await promotionUsage(client, 'TEST', live.campaignId), { reserved: 0, consumed: 0, taken: 0 }, 'a release gives the cap back once');
    assert.equal(await consumePromotion(client, { attemptId: old, invoiceId: invoice('old'), companyId: s.companyId, now: new Date() }), false, 'a stale attempt cannot consume');
    assert.equal(await promotionForAttempt(client, old), null);
    assert.equal(await reserve(s, pinned, fresh), true);
    const again = await row(s, live.campaignId);
    assert.deepEqual([again.id, again.state, again.attemptId, again.releaseCount, again.version, again.releasedAt], [first.id, 'RESERVED', fresh, 1, 2, null]);
    assert.ok(again.acceptedAt >= first.acceptedAt);
    await releasePromotion(client, old);
    assert.equal((await row(s, live.campaignId)).state, 'RESERVED', 'the old attempt cannot release the new reservation');
    assert.equal(await consumePromotion(client, { attemptId: fresh, invoiceId: invoice('new'), companyId: s.companyId, now: new Date() }), true);
    assert.equal(await client.billingPromotionRedemption.count({ where: { companyId: s.companyId } }), 1);
    // The cap of 1 is used: another shop is refused, at the quote and at the reservation.
    const late = await shop();
    assert.deepEqual(await promotionEligibility(client, { settings: state, companyId: late.companyId, offer: month(), tax, now: new Date() }), { ok: false, reason: 'CAP_FULL' });
    assert.equal(await reserve(late, pinned, attempt('late')), 'CAP_FULL');
  });

  it('admits exactly one of two shops racing for the last right: both transactions take the fence first (A15, A36)', async () => {
    const live = campaign({ cap: 1 }), state = await publish([live]), shops = [await shop(), await shop()], pinned = await snapshot(state, shops[0]!);
    // Each transaction stays open after its reservation, so without the fence the other would count zero taken.
    const results = await Promise.all(shops.map((s, index) => reserve(s, pinned, attempt(`race-${index}`), false, 400)));
    assert.deepEqual([...results].sort(), ['CAP_FULL', true].sort());
    assert.deepEqual(await promotionUsage(client, 'TEST', live.campaignId), { reserved: 1, consumed: 0, taken: 1 });
    assert.equal(await client.billingPromotionRedemption.count({ where: { campaignId: live.campaignId } }), 1, 'a refusal writes nothing');
  });

  it('re-validates under the fence: paused, ended, outside the window, stale catalog, changed revision — and keeps an accepted reservation (A04, A15, A28)', async () => {
    const live = campaign(), state = await publish([live]), s = await shop(), kept = await shop(), pinned = await snapshot(state, s), keptAttempt = attempt('kept');
    assert.equal(await reserve(kept, pinned, keptAttempt), true);
    const refused = async (next: BillingPromotionCampaign[], reason: string, policy?: BillingPolicy) => {
      await publish(next, false, policy);
      assert.equal(await reserve(s, pinned, attempt(reason)), reason, reason);
    };
    await refused([{ ...live, paused: true }], 'PAUSED');
    await refused([{ ...live, endedAt: new Date().toISOString() }], 'ENDED');
    await refused([{ ...live, startsAt: new Date(Date.now() + HOUR / 2).toISOString() }], 'NOT_STARTED');
    await refused([{ ...live, startsAt: new Date(Date.now() - 2 * HOUR).toISOString(), endsAt: new Date(Date.now() - 1000).toISOString() }], 'ENDED');
    // The catalog now sells 50 receipts a month: the pinned signature no longer matches the current offer.
    await refused([live], 'CATALOG_STALE', { ...BILLING_DRAFT_POLICY, offerTerms: { STARTER_249: { monthlyPriceSatang: 24900, annualPriceSatang: 249000, monthlyReceiptAllowance: 50 } } });
    await refused([live], 'CATALOG_STALE', { ...BILLING_DRAFT_POLICY, taxTreatment: 'INCLUSIVE_VAT_7', taxRateId: 'txr_synthetic' });
    await refused([{ ...live, revision: 2, displayName: 'ชื่อใหม่' }], 'CHANGED');
    await refused([{ ...live, cap: 50 }], 'CHANGED');
    await refused([], 'CHANGED');
    await refused([{ ...live, rules: [live.rules[1]!] }], 'OFFER_NOT_COVERED');
    assert.equal(await client.billingPromotionRedemption.count({ where: { companyId: s.companyId } }), 0, 'no refusal wrote a row');
    // A reservation committed before the campaign closed keeps its right: it is consumed from its own snapshot (A04).
    await publish([{ ...live, endedAt: new Date().toISOString() }]);
    assert.equal(await consumePromotion(client, { attemptId: keptAttempt, invoiceId: invoice('kept'), companyId: kept.companyId, now: new Date() }), true);
    // A policy that no longer parses admits nothing; the original terms published again admit the buyer.
    await client.billingPolicyRevision.create({ data: { stripeAccountId, livemode: false, version: sequence += 1, state: 'ACTIVE', policyJson: { schemaVersion: 2 },
      promotionJson: { [live.campaignId]: live }, createdByUserId: `admin-${run}` } }).then(revision => client.billingSettings.update({
      where: { id: `${stripeAccountId}:test` }, data: { policyRevisionId: revision.id } }));
    assert.equal(await reserve(s, pinned, attempt('broken')), 'CHANGED');
    await publish([live]);
    assert.equal(await reserve(s, pinned, attempt('ok')), true);
  });

  it('writes the base and the bonus lot, draws the bonus first on an equal expiry, and never carries the bonus (spec §5, Q1, A31)', async () => {
    const s = await shop(), paidAt = new Date(), invoiceId = invoice('lots');
    await client.companyPlanTerm.create({ data: { companyId: s.companyId, tierKey: 'STARTER_249', branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 30,
      termStartAt: paidAt, termEndsAt: appendPackageInterval(paidAt, 'year') } });
    const { paidEnd, benefitEnd } = promotionBoundaries({ serviceStartsAt: paidAt, interval: 'month', bonusMonths: 1 });
    const input = { companyId: s.companyId, billingAccountId: s.accountId, invoiceId, policyRevisionId: 'TEST_ONLY', kind: 'INITIAL' as const,
      baseUnits: 30, bonusUnits: 30, serviceStart: paidAt, paidEnd, benefitEnd, availableAt: paidAt };
    const { base, bonus } = await client.$transaction(tx => grantPromotionPackageReceipts(tx, input));
    const times = (lot: typeof base) => [lot.serviceStart, lot.serviceEnd, lot.availableAt, lot.expiresAt].map(date => date.getTime());
    assert.deepEqual([base.kind, base.sourceKey, base.units, ...times(base)], ['INITIAL', invoiceId, 30, paidAt.getTime(), paidEnd.getTime(), paidAt.getTime(), benefitEnd.getTime()]);
    assert.deepEqual([bonus.kind, bonus.sourceKey, bonus.units, ...times(bonus)],
      ['PROMOTION', promotionReceiptSourceKey(invoiceId), 30, paidEnd.getTime(), benefitEnd.getTime(), paidAt.getTime(), benefitEnd.getTime()]);
    const replay = await client.$transaction(tx => grantPromotionPackageReceipts(tx, input));
    assert.deepEqual([replay.base.id, replay.bonus.id], [base.id, bonus.id], 'a replay grants nothing twice');
    await assert.rejects(client.$transaction(tx => grantPromotionPackageReceipts(tx, { ...input, bonusUnits: 31 })), /receipt_source_changed/);
    assert.deepEqual(await promotionSegments(client, s.accountId), [{ lotId: bonus.id, invoiceId, start: paidEnd, end: benefitEnd }]);
    // A bonus lot is never empty and its expiry is its service end: the seam refuses first, the CHECK behind it.
    const promo = { companyId: s.companyId, billingAccountId: s.accountId, policyRevisionId: 'TEST_ONLY', kind: 'PROMOTION' as const, serviceStart: paidEnd, serviceEnd: benefitEnd, availableAt: paidAt };
    const later = new Date(benefitEnd.getTime() + 86_400_000);
    await assert.rejects(client.$transaction(tx => grantPaidPackageReceipts(tx, { ...promo, sourceKey: 'promo:late', units: 30, expiresAt: later })), /invalid_receipt_grant/);
    await assert.rejects(client.$transaction(tx => grantPaidPackageReceipts(tx, { ...promo, sourceKey: 'promo:empty', units: 0, expiresAt: benefitEnd })), /invalid_receipt_grant/);
    await assert.rejects(client.billingReceiptGrant.create({ data: { ...promo, sourceKey: 'promo:raw-late', sourceHash: 'x', units: 30, expiresAt: later } }));
    await assert.rejects(client.billingReceiptGrant.create({ data: { ...promo, sourceKey: 'promo:raw-empty', sourceHash: 'x', units: 0, expiresAt: benefitEnd } }));
    await assert.rejects(client.billingReceiptGrant.create({ data: { ...promo, kind: 'SOMETHING_NEW', sourceKey: 'promo:raw-kind', sourceHash: 'x', units: 1, expiresAt: benefitEnd } }));

    // Spec example: base 30 + bonus 30, use 20 → base 30 + bonus 10. The base lot is the older row, so only the rule puts the bonus first.
    const now = new Date(paidAt.getTime() + 1000);
    for (let index = 0; index < 20; index += 1) {
      const next = (await paidReceiptBalance(client, s.companyId, s.accountId, now)).nextGrantId;
      assert.equal(next, bonus.id, `unit ${index + 1}`);
      await client.receiptUnitEntry.create({ data: { companyId: s.companyId, grantId: next!, operationKey: `promo-${run}-${index}`, generation: 1, kind: 'RESERVE', units: 1 } });
    }
    const remaining = async (at = now) => Object.fromEntries((await receiptLots(client, visibleReceiptLots(s.companyId, s.accountId, at))).map(lot => [lot.id, lot.remaining]));
    assert.deepEqual(await remaining(), { [base.id]: 30, [bonus.id]: 10 });
    assert.deepEqual((await receiptLots(client, visibleReceiptLots(s.companyId, s.accountId, now))).map(lot => lot.id), [bonus.id, base.id]);
    // A normal repeat before the end carries the base lot to the new period and leaves the bonus on its own date.
    const nextEnd = appendPackageInterval(benefitEnd, 'month');
    const repeat = await client.$transaction(tx => grantPaidPackageReceipts(tx, { companyId: s.companyId, billingAccountId: s.accountId, sourceKey: invoice('repeat'),
      policyRevisionId: 'TEST_ONLY', kind: 'REPEAT', units: 30, serviceStart: benefitEnd, serviceEnd: nextEnd, availableAt: now, expiresAt: nextEnd }));
    const lots = await client.billingReceiptGrant.findMany({ where: { companyId: s.companyId } });
    assert.equal(lots.find(lot => lot.id === base.id)?.expiresAt.getTime(), nextEnd.getTime(), 'the base lot is carried');
    assert.equal(lots.find(lot => lot.id === bonus.id)?.expiresAt.getTime(), benefitEnd.getTime(), 'the bonus lot is not');
    assert.deepEqual(await remaining(benefitEnd), { [base.id]: 30, [repeat.id]: 30 }, 'after the free month ends: 60, not 40 and not 70');
  });
});
