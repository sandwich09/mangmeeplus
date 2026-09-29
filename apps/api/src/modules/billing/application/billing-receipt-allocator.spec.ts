/**
 * Add-on plan PR B, B1 (spec §6, §6.1, D4, D8): the receipt allocator and its projection. Package lots go
 * first, then what the team gave, then what the shop bought; oldest expiry first inside each group. An
 * add-on lot serves a one-page image only. The projection counts an admission from before the ledger
 * (null generation) from its event, and everything after it from the entries.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { packageReceiptBalance, paidReceiptBalance, receiptLots } from './billing-receipt-grants';

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
