import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BILLING_DRAFT_POLICY, BILLING_PAID_TIERS, billingOffer, type BillingPromotionCampaign } from '@watchdog-bms/contracts';
import { assertPromotionPublication, parsePromotionCampaigns, parsePromotionCampaignsLenient, parsePromotionDraft, promotionAdmission, promotionCampaignStatus,
  promotionOfferSignature, promotionSignatures, promotionTermsHash, promotionUnavailable, promotionUnsupportedPurchase } from './billing-promotion';

/** Promotion plan §5 / spec §4–§6: the pure rules of a campaign — signature, parsing, status, publication, support matrix. */
const tax = 'NOT_VAT_REGISTERED' as const, at = (iso: string) => new Date(iso);
const catalog = (policy = BILLING_DRAFT_POLICY) => BILLING_PAID_TIERS.flatMap(tier => (['month', 'year'] as const).map(interval => billingOffer(tier, interval, policy)));
const offers = catalog(), month = billingOffer('STARTER_249', 'month'), year = billingOffer('STARTER_249', 'year');
const campaign = (over: Partial<BillingPromotionCampaign> = {}): BillingPromotionCampaign => ({ campaignId: 'starter-2026', type: 'BONUS_MONTHS', revision: 1,
  internalName: 'Starter 249 ตุลาคม', description: null, displayName: 'ซื้อ 1 เดือน ฟรี 1 เดือน', startsAt: '2026-10-10T00:00:00.000Z', endsAt: '2026-11-10T00:00:00.000Z',
  cap: 100, paused: false, endedAt: null, rules: [
    { offerKey: 'STARTER_249', interval: 'month', bonusMonths: 1, bonusReceiptUnits: 30, offerSignature: promotionOfferSignature(month, tax) },
    { offerKey: 'STARTER_249', interval: 'year', bonusMonths: 1, bonusReceiptUnits: 30, offerSignature: promotionOfferSignature(year, tax) }], ...over });
const one = (item: BillingPromotionCampaign) => ({ [item.campaignId]: item });
const code = (expected: string) => (error: any) => (error.getResponse?.().code ?? error.message) === expected;
const inside = at('2026-10-20T00:00:00.000Z'), before = at('2026-10-01T00:00:00.000Z');

test('the offer signature is stable and follows price, base receipts, tax and cadence — never the label', () => {
  const signature = promotionOfferSignature(month, tax);
  assert.match(signature, /^[0-9a-f]{64}$/);
  assert.equal(promotionOfferSignature({ ...month }, tax), signature);
  const relabelled = { ...month, label: 'ชื่อใหม่', featureKeys: [], branchLimit: 9 };
  assert.equal(promotionOfferSignature(relabelled, tax), signature, 'decoration is not part of it');
  for (const changed of [{ ...month, priceSatang: 25900 }, { ...month, receiptAllowance: 50 }, { ...month, intervalCount: 2 }, year])
    assert.notEqual(promotionOfferSignature(changed, tax), signature);
  assert.notEqual(promotionOfferSignature(month, 'INCLUSIVE_VAT_7'), signature);
  assert.equal(promotionSignatures(offers, tax)['STARTER_249:month'], signature);
});

test('strict parse accepts only complete campaigns keyed by their own id; lenient parse turns a bad document into no campaign', () => {
  const good = one(campaign());
  assert.deepEqual(parsePromotionCampaigns(good), good);
  assert.deepEqual(parsePromotionCampaigns(JSON.parse(JSON.stringify(good))), good, 'a JSONB round trip parses the same');
  assert.deepEqual(parsePromotionCampaigns(null), {});
  assert.deepEqual(parsePromotionCampaigns(undefined), {});
  const bad: unknown[] = [[], 'x', { other: campaign() }, one({ ...campaign(), extra: 1 } as never), one(campaign({ type: 'DISCOUNT' as never })),
    one(campaign({ revision: 0 })), one(campaign({ displayName: '<b>ฟรี</b>' })), one(campaign({ displayName: ' ' })), one(campaign({ internalName: 'x'.repeat(121) })),
    one(campaign({ startsAt: '2026-10-10' })), one(campaign({ endsAt: '2026-10-10T00:00:00.000Z' })), one(campaign({ cap: 0 })), one(campaign({ cap: 1.5 })),
    one(campaign({ paused: 'no' as never })), one(campaign({ endedAt: 'yesterday' })), one(campaign({ rules: [] })),
    one(campaign({ rules: [campaign().rules[0]!, campaign().rules[0]!] })), one(campaign({ rules: [{ ...campaign().rules[0]!, bonusMonths: 0 }] })), one(campaign({ rules: [{ ...campaign().rules[0]!, bonusReceiptUnits: 0 }] })),
    one(campaign({ rules: [{ ...campaign().rules[0]!, offerSignature: 'short' }] })), one(campaign({ rules: [{ ...campaign().rules[0]!, offerKey: 'FREE_TRIAL_15' as never }] })),
    one((({ description: _description, ...rest }) => rest)(campaign()) as never)];
  for (const value of bad) {
    assert.throws(() => parsePromotionCampaigns(value), code('CONTROL_PROMOTION_INVALID'), JSON.stringify(value).slice(0, 80));
    assert.deepEqual(parsePromotionCampaignsLenient(value), {});
  }
  assert.deepEqual(parsePromotionCampaignsLenient(good), good);
  // What an Admin reads when a campaign is refused: Thai, with the stable code beside it.
  assert.deepEqual((() => { try { parsePromotionCampaigns([]); } catch (error: any) { return error.getResponse(); } })(),
    { code: 'CONTROL_PROMOTION_INVALID', message: 'ข้อมูลแคมเปญไม่ถูกต้อง' });
});

test('a draft may be incomplete: it lists what is missing or wrong and refuses only unknown fields and a bad id', () => {
  assert.deepEqual(parsePromotionDraft({ campaignId: 'c1' }), { values: { campaignId: 'c1' },
    validationErrors: ['type', 'internalName', 'displayName', 'rules', 'startsAt', 'endsAt', 'cap'].map(field => ({ field, code: 'REQUIRED' })) });
  const { offerSignature: _signature, ...rule } = campaign().rules[0]!;
  const full = { campaignId: 'c1', type: 'BONUS_MONTHS', internalName: 'ภายใน', description: null, displayName: 'ลูกค้าเห็น', rules: [rule],
    startsAt: '2026-10-10T00:00:00.000Z', endsAt: '2026-11-10T00:00:00.000Z', cap: null };
  assert.deepEqual(parsePromotionDraft(full), { values: full, validationErrors: [] });
  // The bonus lot and its database CHECK need at least one receipt: a zero is a wrong rule in a draft too.
  assert.deepEqual(parsePromotionDraft({ ...full, rules: [{ ...rule, bonusReceiptUnits: 0 }] }).validationErrors, [{ field: 'rules', code: 'INVALID' }]);
  const wrong = parsePromotionDraft({ ...full, displayName: '<i>x</i>', cap: 0, endsAt: '2026-10-01T00:00:00.000Z', rules: [{ ...rule, offerSignature: 'a'.repeat(64) }] });
  assert.deepEqual(wrong.validationErrors, [{ field: 'displayName', code: 'INVALID' }, { field: 'rules', code: 'INVALID' }, { field: 'cap', code: 'INVALID' },
    { field: 'endsAt', code: 'END_NOT_AFTER_START' }]);
  assert.equal(wrong.values.displayName, '<i>x</i>', 'typed text is shown back');
  assert.ok(!('cap' in wrong.values) && !('rules' in wrong.values), 'a value that is not text is dropped');
  assert.throws(() => parsePromotionDraft({ ...full, revision: 3 }));
  assert.throws(() => parsePromotionDraft({ ...full, campaignId: 'no spaces' }), code('CONTROL_PROMOTION_INVALID'));
  assert.throws(() => parsePromotionDraft(null));
});

test('the terms hash covers the terms and the revision, not pause or end', () => {
  const hash = promotionTermsHash(campaign());
  assert.equal(promotionTermsHash(campaign({ paused: true, endedAt: '2026-10-21T00:00:00.000Z' })), hash);
  for (const over of [{ revision: 2 }, { displayName: 'ชื่อใหม่' }, { cap: 5 }, { endsAt: '2026-12-01T00:00:00.000Z' }, { rules: [campaign().rules[0]!] }])
    assert.notEqual(promotionTermsHash(campaign(over)), hash, JSON.stringify(over));
});

test('status and admission: start is inside, end is outside; paused, ended and a stale catalog close new reservations', () => {
  const signatures = promotionSignatures(offers, tax), status = (item: BillingPromotionCampaign, now: Date) => promotionCampaignStatus(item, now, signatures);
  // The application seam's call: the whole current catalog, the offer being bought as the caller priced it.
  const reason = (item: BillingPromotionCampaign, now: Date, offer = month, treatment: typeof tax | 'INCLUSIVE_VAT_7' = tax, current = offers) => {
    const result = promotionAdmission(item, offer, promotionSignatures([...current, offer], treatment), now);
    return 'reason' in result ? result.reason : null;
  };
  assert.equal(status(campaign(), at('2026-10-09T23:59:59.999Z')), 'SCHEDULED');
  assert.equal(reason(campaign(), at('2026-10-09T23:59:59.999Z')), 'NOT_STARTED');
  assert.equal(status(campaign(), at('2026-10-10T00:00:00.000Z')), 'ACTIVE');
  assert.equal(reason(campaign(), at('2026-10-10T00:00:00.000Z')), null);
  assert.equal(status(campaign(), at('2026-11-09T23:59:59.999Z')), 'ACTIVE');
  assert.equal(status(campaign(), at('2026-11-10T00:00:00.000Z')), 'ENDED');
  assert.equal(reason(campaign(), at('2026-11-10T00:00:00.000Z')), 'ENDED');
  assert.equal(status(campaign({ paused: true }), inside), 'PAUSED');
  assert.equal(reason(campaign({ paused: true }), inside), 'PAUSED');
  assert.equal(status(campaign({ endedAt: '2026-10-15T00:00:00.000Z', paused: true }), inside), 'ENDED');
  assert.equal(reason(campaign({ endedAt: '2026-10-15T00:00:00.000Z' }), inside), 'ENDED');
  // A re-priced or re-quota'd catalog: the campaign stops taking reservations, NORMAL is untouched (A28).
  const dearer = catalog({ ...BILLING_DRAFT_POLICY, offerTerms: { STARTER_249: { monthlyPriceSatang: 24900, annualPriceSatang: 249000, monthlyReceiptAllowance: 50 } } });
  assert.equal(promotionCampaignStatus(campaign(), inside, promotionSignatures(dearer, tax)), 'CATALOG_STALE');
  assert.equal(reason(campaign(), inside, dearer[0]!), 'CATALOG_STALE');
  assert.equal(reason(campaign(), inside, month, 'INCLUSIVE_VAT_7'), 'CATALOG_STALE');
  assert.equal(reason(campaign(), inside, billingOffer('BASIC_499', 'month')), 'OFFER_NOT_COVERED');
  assert.equal(reason(campaign({ rules: [campaign().rules[0]!] }), inside, year), 'OFFER_NOT_COVERED');
  // Spec §4: ONE stale rule stops the whole campaign. Only the yearly offer changed; the monthly one, still current, is refused too.
  const yearChanged = offers.map(offer => offer.offerKey === 'STARTER_249' && offer.interval === 'year' ? { ...offer, priceSatang: offer.priceSatang + 100 } : offer);
  assert.equal(promotionCampaignStatus(campaign(), inside, promotionSignatures(yearChanged, tax)), 'CATALOG_STALE');
  assert.equal(reason(campaign(), inside, month, tax, yearChanged), 'CATALOG_STALE');
  assert.equal(reason(campaign({ rules: [campaign().rules[0]!] }), inside, month, tax, yearChanged), null, 'a campaign that does not cover the changed offer is untouched');
  const admitted = promotionAdmission(campaign(), year, signatures, inside);
  assert.deepEqual('rule' in admitted && [admitted.rule.interval, admitted.rule.bonusMonths, admitted.rule.bonusReceiptUnits], ['year', 1, 30]);
  assert.deepEqual(promotionUnavailable('CAP_FULL').getResponse(), { code: 'PROMOTION_UNAVAILABLE', reason: 'CAP_FULL', message: 'สิทธิ์โปรโมชั่นนี้เต็มแล้ว' });
});

test('publication: the release-1 template on the current catalog, no overlap, cap not below taken, ended is final, nothing is removed', () => {
  const publish = (from: Record<string, BillingPromotionCampaign>, to: Record<string, BillingPromotionCampaign>, taken: Record<string, number> = {}, now = before, list = offers) =>
    assertPromotionPublication(from, to, list, tax, taken, now);
  const live = campaign();
  publish({}, one(live));
  // Template: Starter only, +1 month, +30 receipts, on a 30/360 catalog at 249 baht a month.
  assert.throws(() => publish({}, one(campaign({ revision: 2 }))), code('CONTROL_PROMOTION_INVALID'), 'a new campaign starts at revision 1');
  assert.throws(() => publish({}, one(campaign({ rules: [{ ...live.rules[0]!, bonusMonths: 2 }] }))), code('CONTROL_PROMOTION_INVALID'));
  assert.throws(() => publish({}, one(campaign({ rules: [{ ...live.rules[0]!, bonusReceiptUnits: 60 }] }))), code('CONTROL_PROMOTION_INVALID'));
  const basic = billingOffer('BASIC_499', 'month');
  assert.throws(() => publish({}, one(campaign({ rules: [{ offerKey: 'BASIC_499', interval: 'month', bonusMonths: 1, bonusReceiptUnits: 30,
    offerSignature: promotionOfferSignature(basic, tax) }] }))), code('CONTROL_PROMOTION_INVALID'));
  assert.throws(() => publish({}, one(campaign({ endsAt: '2026-09-30T00:00:00.000Z', startsAt: '2026-09-01T00:00:00.000Z' }))), code('CONTROL_PROMOTION_INVALID'), 'already over');
  // F01 / A28: a 50/600 catalog. The old signature is stale; a fresh signature still cannot promise 60/390.
  const bigger = catalog({ ...BILLING_DRAFT_POLICY, offerTerms: { STARTER_249: { monthlyPriceSatang: 24900, annualPriceSatang: 249000, monthlyReceiptAllowance: 50 } } });
  assert.throws(() => publish({}, one(live), {}, before, bigger), code('CONTROL_PROMOTION_CATALOG_STALE'));
  const resigned = campaign({ rules: live.rules.map(rule => ({ ...rule, offerSignature: promotionOfferSignature(bigger.find(o => o.offerKey === rule.offerKey && o.interval === rule.interval)!, tax) })) });
  assert.throws(() => publish({}, one(resigned), {}, before, bigger), code('CONTROL_PROMOTION_INVALID'));
  const repriced = catalog({ ...BILLING_DRAFT_POLICY, offerTerms: { STARTER_249: { monthlyPriceSatang: 29900, annualPriceSatang: 249000, monthlyReceiptAllowance: 30 } } });
  const yearly = campaign({ rules: [{ ...live.rules[1]!, offerSignature: promotionOfferSignature(repriced[1]!, tax) }] });
  assert.throws(() => publish({}, one(yearly), {}, before, repriced), code('CONTROL_PROMOTION_INVALID'), 'the yearly rule alone still needs the 249 monthly price');

  // Edits: changed terms need revision + 1, unchanged terms keep it; pause and end need neither the template nor a current catalog.
  assert.throws(() => publish(one(live), one(campaign({ displayName: 'ชื่อใหม่' }))), code('CONTROL_PROMOTION_INVALID'));
  publish(one(live), one(campaign({ displayName: 'ชื่อใหม่', revision: 2 })));
  assert.throws(() => publish(one(live), one(campaign({ revision: 2 }))), code('CONTROL_PROMOTION_INVALID'));
  publish(one(live), one(campaign({ paused: true })), {}, inside, bigger);
  publish(one(live), one(campaign({ endedAt: inside.toISOString() })), {}, inside, bigger);
  // Resume opens admission again: the catalog must be current.
  publish(one(campaign({ paused: true })), one(live), {}, inside);
  assert.throws(() => publish(one(campaign({ paused: true })), one(live), {}, inside, bigger), code('CONTROL_PROMOTION_CATALOG_STALE'));

  // Cap: never below RESERVED + CONSUMED, read under the fence.
  publish(one(live), one(campaign({ cap: 3, revision: 2 })), { [live.campaignId]: 3 });
  publish(one(live), one(campaign({ cap: null, revision: 2 })), { [live.campaignId]: 500 });
  assert.throws(() => publish(one(live), one(campaign({ cap: 2, revision: 2 })), { [live.campaignId]: 3 }), code('CONTROL_PROMOTION_CAP_BELOW_USED'));

  // Ended (by command or by the clock) is immutable and cannot be reopened; a published campaign is never removed.
  const closed = campaign({ endedAt: '2026-10-15T00:00:00.000Z' });
  publish(one(closed), one(closed), {}, inside);
  assert.throws(() => publish(one(closed), one(campaign({ endedAt: null })), {}, inside), code('CONTROL_PROMOTION_ENDED'));
  assert.throws(() => publish(one(closed), one({ ...closed, displayName: 'แก้ชื่อ' }), {}, inside), code('CONTROL_PROMOTION_ENDED'));
  assert.throws(() => publish(one(live), one(campaign({ endsAt: '2027-01-01T00:00:00.000Z', revision: 2 })), {}, at('2026-11-10T00:00:00.000Z')), code('CONTROL_PROMOTION_ENDED'));
  assert.throws(() => publish(one(live), {}), code('CONTROL_PROMOTION_INVALID'));
  assert.throws(() => publish(one(live), { other: campaign({ campaignId: 'other', startsAt: '2027-01-01T00:00:00.000Z', endsAt: '2027-02-01T00:00:00.000Z' }) }), code('CONTROL_PROMOTION_INVALID'));

  // One campaign per offer and interval at a time; an ended one frees its window, a different interval never collides.
  const second = (over: Partial<BillingPromotionCampaign> = {}) => campaign({ campaignId: 'second', ...over });
  assert.throws(() => publish(one(live), { ...one(live), ...one(second({ startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z' })) }), code('CONTROL_PROMOTION_OVERLAP'));
  publish(one(live), { ...one(live), ...one(second({ startsAt: '2026-11-10T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z' })) });
  publish(one(closed), { ...one(closed), ...one(second()) }, {}, at('2026-10-15T00:00:00.000Z'));
  publish({}, { ...one(campaign({ rules: [live.rules[0]!] })), ...one(second({ rules: [live.rules[1]!] })) });
});

test('release-1 support matrix: first purchase or restart in any mode, a one-time repeat; everything else is refused with a reason', () => {
  const ask = (purchaseKind: string, purchaseMode: 'CARD_AUTO' | 'CARD_ONCE' | 'PROMPTPAY_ONCE' | 'PROMPTPAY_RENEW', over = {}) =>
    promotionUnsupportedPurchase({ purchaseKind, purchaseMode, hasLiveSubscription: false, deal: false, upgrade: false, scheduledChange: false, ...over });
  for (const mode of ['CARD_AUTO', 'CARD_ONCE', 'PROMPTPAY_ONCE', 'PROMPTPAY_RENEW'] as const) {
    assert.equal(ask('INITIAL', mode), null); assert.equal(ask('RESTART', mode), null);
    assert.equal(ask('REPEAT', mode), mode.endsWith('ONCE') ? null : 'PURCHASE_KIND_UNSUPPORTED');
    for (const kind of ['UPGRADE', 'FULL_PACKAGE_UPGRADE', 'SCHEDULED_CHANGE', 'ADVANCE_DEAL']) assert.equal(ask(kind, mode), 'PURCHASE_KIND_UNSUPPORTED', `${kind} ${mode}`);
    for (const over of [{ deal: true }, { upgrade: true }, { scheduledChange: true }]) assert.equal(ask('INITIAL', mode, over), 'PURCHASE_KIND_UNSUPPORTED');
  }
  assert.equal(ask('REPEAT', 'CARD_ONCE', { hasLiveSubscription: true }), 'PURCHASE_KIND_UNSUPPORTED', 'a live subscription defers its repeat');
  assert.equal(promotionUnsupportedPurchase({ purchaseKind: undefined, purchaseMode: undefined, hasLiveSubscription: false, deal: false, upgrade: false, scheduledChange: false }), 'PURCHASE_KIND_UNSUPPORTED');
});
