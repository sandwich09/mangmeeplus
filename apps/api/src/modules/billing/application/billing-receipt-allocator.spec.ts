/**
 * Add-on plan PR B, B1 (spec §6, §6.1, D4, D8): the receipt allocator and its projection. Package lots go
 * first, then what the team gave, then what the shop bought; oldest expiry first inside each group. An
 * add-on lot serves a one-page image only. The projection counts an admission from before the ledger
 * (null generation) from its event, and everything after it from the entries. The PROMOTION bonus lot (promotion plan R7, spec
 * Q1; A08, A31) is a package-group lot: the earliest expiry first, the bonus before the base on an equal one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isReceiptAddOnKind, isReceiptPackageKind, packageReceiptBalance, paidReceiptBalance, receiptLots } from './billing-receipt-grants';

type Lot = { id: string; kind: string; units: number; expiresAt: Date; createdAt?: Date; legacy?: number };
type Entry = { grantId: string; kind: 'RESERVE' | 'CONSUME' | 'RELEASE' | 'REVOKE'; units: number };

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n));
/** Just enough of the two tables: the query order and the per-lot entry sums the projection asks for. */
function db(lots: Lot[], entries: Entry[] = []) {
  const at = new Date('2026-09-29T00:00:00.000Z');
  return {
    billingReceiptGrant: { findMany: async () => [...lots]
      .map((lot) => ({ id: lot.id, kind: lot.kind, units: lot.units, availableAt: at, expiresAt: lot.expiresAt, revokedAt: null,
        createdAt: lot.createdAt ?? at, _count: { admissions: lot.legacy ?? 0 } }))
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)) },
    receiptUnitEntry: { groupBy: async () => [...new Set(entries.map((e) => `${e.grantId}|${e.kind}`))].map((key) => {
      const [grantId, kind] = key.split('|') as [string, string];
      return { grantId, kind, _sum: { units: entries.filter((e) => e.grantId === grantId && e.kind === kind).reduce((t, e) => t + e.units, 0) } };
    }) },
  } as never;
}
const next = async (lots: Lot[], entries: Entry[] = [], image = true) => (await paidReceiptBalance(db(lots, entries), 'co', 'acct', new Date(), image)).nextGrantId;

describe('receipt allocator (add-on plan PR B, B1)', () => {
  const lots: Lot[] = [
    // Purchased expires first and the team gift next: FEFO across everything would pick them first.
    { id: 'paid', kind: 'ADD_ON_PAID', units: 1, expiresAt: day(1) },
    { id: 'gift', kind: 'ADMIN_ADJUSTMENT', units: 1, expiresAt: day(2) },
    { id: 'event', kind: 'SALES_EVENT', units: 1, expiresAt: day(40) },
    { id: 'team', kind: 'ADD_ON_ADMIN', units: 1, expiresAt: day(30) },
    { id: 'package', kind: 'INITIAL', units: 1, expiresAt: day(20) },
    { id: 'carry', kind: 'TRIAL_CARRYOVER', units: 1, expiresAt: day(10) },
  ];

  it('uses package lots, then team lots, then purchased ones — oldest expiry first inside each group', async () => {
    const order: string[] = [], entries: Entry[] = [];
    for (let i = 0; i < lots.length; i += 1) {
      const id = await next(lots, entries);
      assert.ok(id, `unit ${i + 1}`);
      order.push(id!);
      entries.push({ grantId: id!, kind: 'RESERVE', units: 1 });
    }
    assert.deepEqual(order, ['carry', 'package', 'gift', 'team', 'event', 'paid']);
    assert.equal(await next(lots, entries), null, 'every unit reserved');
  });

  it('keeps an add-on lot for a one-page image only, while a PDF still reads the package and legacy gift', async () => {
    assert.equal(await next(lots, [], false), 'carry');
    const spent: Entry[] = ['carry', 'package', 'gift'].map((grantId) => ({ grantId, kind: 'RESERVE', units: 1 }));
    assert.equal(await next(lots, spent, false), null, 'only add-on units left: the PDF is refused, never paid from them (D4)');
    assert.equal(await next(lots, spent, true), 'team');
    const balance = await paidReceiptBalance(db(lots, spent), 'co', 'acct', new Date(), false);
    assert.deepEqual([balance.limit, balance.used, balance.remaining], [6, 3, 3], 'the balance still shows what the shop holds');
  });

  it('never counts an add-on lot as package balance carried into a package purchase', async () => {
    const pkg = await packageReceiptBalance(db(lots), 'co', 'acct');
    assert.deepEqual([pkg.limit, pkg.remaining], [3, 3], 'package + trial carryover + the legacy gift, no add-on');
    assert.equal(pkg.nextGrantId, 'carry');
  });

  it('counts a legacy admission from its event, a reservation, a use and a revoke from the ledger', async () => {
    const [lot] = await receiptLots(db([{ id: 'l', kind: 'RENEWAL', units: 10, expiresAt: day(9), legacy: 2 }], [
      { grantId: 'l', kind: 'RESERVE', units: 1 }, { grantId: 'l', kind: 'RESERVE', units: 1 }, { grantId: 'l', kind: 'RESERVE', units: 1 },
      { grantId: 'l', kind: 'CONSUME', units: 1 }, { grantId: 'l', kind: 'RELEASE', units: 1 }, { grantId: 'l', kind: 'REVOKE', units: 3 },
    ]), {});
    // 3 reserved: 1 used, 1 handed back, 1 still running. Used = 2 legacy + 1; revoked 3; 10 - 3 - 1 - 3 = 3.
    assert.deepEqual([lot!.consumed, lot!.reserved, lot!.revoked, lot!.remaining], [3, 1, 3, 3]);
  });

  it('fails closed on a lot kind it does not know or a lot that is overdrawn', async () => {
    await assert.rejects(receiptLots(db([{ id: 'x', kind: 'SOMETHING_NEW', units: 1, expiresAt: day(1) }]), {}), /receipt_balance_corrupt/);
    await assert.rejects(receiptLots(db([{ id: 'x', kind: 'INITIAL', units: 1, expiresAt: day(1), legacy: 1 }],
      [{ grantId: 'x', kind: 'RESERVE', units: 1 }]), {}), /receipt_balance_corrupt/);
    await assert.rejects(receiptLots(db([{ id: 'x', kind: 'INITIAL', units: 1, expiresAt: day(1) }],
      [{ grantId: 'x', kind: 'CONSUME', units: 1 }]), {}), /receipt_balance_corrupt/, 'a use without its reservation');
  });

  it('asks the ledger nothing for a shop with no lot (legacy monthly base keeps its old path)', async () => {
    const empty = { billingReceiptGrant: { findMany: async () => [] } } as never;
    assert.deepEqual(await paidReceiptBalance(empty, 'co', null), { limit: 0, used: 0, remaining: 0, nextGrantId: null, expiresAt: null });
  });
});

describe('receipt allocator and the PROMOTION bonus lot (promotion plan R7, spec Q1; A08, A31)', () => {
  /** The order the allocator hands out `count` single units, reserving each as the admission does. */
  async function draw(lots: Lot[], count: number, image = true) {
    const order: string[] = [], entries: Entry[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = await next(lots, entries, image);
      if (!id) break;
      order.push(id);
      entries.push({ grantId: id, kind: 'RESERVE', units: 1 });
    }
    return { order, entries };
  }

  it('knows PROMOTION as a package-group kind — counted in the package balance, never an add-on lot', async () => {
    assert.deepEqual([isReceiptPackageKind('PROMOTION'), isReceiptAddOnKind('PROMOTION')], [true, false]);
    const lots: Lot[] = [{ id: 'base', kind: 'INITIAL', units: 30, expiresAt: day(31) }, { id: 'bonus', kind: 'PROMOTION', units: 30, expiresAt: day(31) }];
    const pkg = await packageReceiptBalance(db(lots), 'co', 'acct');
    assert.deepEqual([pkg.limit, pkg.remaining], [60, 60], 'the bonus is part of what a package purchase carries as package balance');
  });

  it('draws the bonus lot before the base lot on an equal expiry, whichever row is older (spec example: use 20 of 30 + 30)', async () => {
    for (const [baseCreated, bonusCreated] of [[day(-2), day(-1)], [day(-1), day(-2)]]) {
      const lots: Lot[] = [{ id: 'a-base', kind: 'INITIAL', units: 30, expiresAt: day(31), createdAt: baseCreated },
        { id: 'z-bonus', kind: 'PROMOTION', units: 30, expiresAt: day(31), createdAt: bonusCreated }];
      const { order, entries } = await draw(lots, 20);
      assert.deepEqual([...new Set(order)], ['z-bonus'], 'the 20 units all come from the bonus lot');
      const found = Object.fromEntries((await receiptLots(db(lots, entries), {})).map((lot) => [lot.id, lot.remaining]));
      assert.deepEqual(found, { 'a-base': 30, 'z-bonus': 10 }, 'base 30 + bonus 10');
      assert.deepEqual((await draw(lots, 31)).order.slice(-2), ['z-bonus', 'a-base'], 'the base lot only starts once the bonus is spent');
      const balance = await paidReceiptBalance(db(lots, entries), 'co', 'acct', new Date(), false);
      assert.deepEqual([balance.limit, balance.used, balance.remaining], [60, 20, 40]);
    }
  });

  it('draws the earliest expiry first whatever the kind — a carried base lot that outlives the bonus comes after it, a sooner one before', async () => {
    const carried: Lot[] = [{ id: 'base', kind: 'INITIAL', units: 1, expiresAt: day(60) }, { id: 'bonus', kind: 'PROMOTION', units: 1, expiresAt: day(31) }];
    assert.deepEqual((await draw(carried, 2)).order, ['bonus', 'base']);
    const sooner: Lot[] = [{ id: 'bonus', kind: 'PROMOTION', units: 1, expiresAt: day(31) }, { id: 'base', kind: 'INITIAL', units: 1, expiresAt: day(10) },
      { id: 'carry', kind: 'TRIAL_CARRYOVER', units: 1, expiresAt: day(5) }];
    assert.deepEqual((await draw(sooner, 3)).order, ['carry', 'base', 'bonus']);
  });

  it('keeps PROMOTION in the package group: before a team lot and a purchased lot even when those expire sooner', async () => {
    const lots: Lot[] = [{ id: 'paid', kind: 'ADD_ON_PAID', units: 1, expiresAt: day(1) }, { id: 'gift', kind: 'ADMIN_ADJUSTMENT', units: 1, expiresAt: day(2) },
      { id: 'team', kind: 'ADD_ON_ADMIN', units: 1, expiresAt: day(3) }, { id: 'bonus', kind: 'PROMOTION', units: 1, expiresAt: day(31) }];
    assert.deepEqual((await draw(lots, 4)).order, ['bonus', 'gift', 'team', 'paid']);
  });

  it('lets a PDF draw a PROMOTION lot — it is not an add-on kind — while the add-on lots stay for a one-page image', async () => {
    const lots: Lot[] = [{ id: 'team', kind: 'ADD_ON_ADMIN', units: 5, expiresAt: day(5) }, { id: 'bonus', kind: 'PROMOTION', units: 2, expiresAt: day(31) }];
    const pdf = await draw(lots, 4, false);
    assert.deepEqual(pdf.order, ['bonus', 'bonus'], 'a PDF is served by the bonus and then refused, never paid from the add-on lot');
    assert.equal(await next(lots, pdf.entries, true), 'team', 'an image still reads the add-on lot');
    const balance = await paidReceiptBalance(db(lots, pdf.entries), 'co', 'acct', new Date(), false);
    assert.deepEqual([balance.limit, balance.used, balance.remaining, balance.nextGrantId], [7, 2, 5, null]);
  });

  it('still fails closed on a kind it does not know, with a PROMOTION lot beside it, and on an overdrawn bonus lot', async () => {
    const bonus: Lot = { id: 'bonus', kind: 'PROMOTION', units: 1, expiresAt: day(31) };
    for (const kind of ['SOMETHING_NEW', 'PROMO', 'promotion', 'PROMOTION ']) {
      await assert.rejects(receiptLots(db([bonus, { id: 'x', kind, units: 1, expiresAt: day(1) }]), {}), /receipt_balance_corrupt/, kind);
    }
    await assert.rejects(receiptLots(db([bonus], [{ grantId: 'bonus', kind: 'CONSUME', units: 1 }]), {}), /receipt_balance_corrupt/, 'a use without its reservation');
    await assert.rejects(receiptLots(db([bonus], [{ grantId: 'bonus', kind: 'RESERVE', units: 2 }]), {}), /receipt_balance_corrupt/, 'more reserved than granted');
  });
});
