import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { demoSampleRows } from './demo-sample-data';
import { documentDate } from './demo-data/expense-writes';

function total(rows: readonly { amount: string }[]): string {
  return (rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) / 100).toFixed(2);
}

describe('demoSampleRows', () => {
  for (const [instant, months] of [
    ['2026-11-06T08:00:00+07:00', ['2026-09', '2026-10', '2026-11']],
    ['2026-03-02T00:05:00+07:00', ['2026-01', '2026-02', '2026-03']],
    ['2026-01-31T23:59:00+07:00', ['2025-11', '2025-12', '2026-01']],
    ['2026-03-01T00:00:00+07:00', ['2026-01', '2026-02', '2026-03']],
  ] as const) {
    it(`resolves dates, counts and exact current-month amounts at ${instant}`, () => {
      const now = new Date(instant);
      const rows = demoSampleRows(now);
      assert.equal(rows.expenses.length, 32);
      assert.equal(rows.expenses.filter(row => !row.sourceClaimKey).length, 30);
      assert.equal(rows.expenses.filter(row => row.sourceClaimKey).length, 2);
      assert.deepEqual([-2, -1, 0].map(month => rows.expenses.filter(row => row.monthOffset === month).length), [12, 13, 7]);
      const current = rows.expenses.filter(row => row.monthOffset === 0);
      const recorded = current.filter(row => row.status === 'CONFIRMED');
      const drafts = rows.expenses.filter(row => row.status === 'READY_FOR_CONFIRMATION');
      assert.equal(drafts.length, 2);
      assert.equal(total(recorded.filter(row => row.category === 'ค่าเช่า')), '18000.00');
      assert.equal(total(recorded.filter(row => row.category === 'วัตถุดิบ')), '6670.00');
      assert.equal(total(recorded.filter(row => row.category === 'ค่าแก๊ส')), '1640.00');
      assert.equal(total(recorded), '26310.00');
      assert.equal(total(recorded.filter(row => !row.sourceClaimKey)), '26070.00');
      assert.equal(total(drafts), '8297.50');
      const monthKey = (date: Date) => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 7);
      assert.equal(new Set(rows.expenses.map(row => monthKey(row.date))).size, 3);
      assert.deepEqual([...new Set(rows.expenses.map(row => monthKey(row.date)))].sort(), months);
      assert.equal(new Set(rows.expenses.map(row => row.key)).size, 32);
      for (const row of [...rows.expenses, ...rows.claims, rows.certificate]) {
        assert.ok(row.date <= now);
        const bangkokDay = new Date(row.date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
        assert.equal(documentDate(row.date).toISOString(), `${bangkokDay}T00:00:00.000Z`);
      }
      for (const row of current) assert.equal(monthKey(row.date), monthKey(now));
      const repair = rows.expenses.find(row => row.key === rows.certificate.expenseKey)!;
      assert.equal(repair.amount, '3500.00');
      assert.equal(repair.whtAmount, '105.00');
      assert.equal(repair.netPayableAmount, '3395.00');
      assert.equal(repair.date.toISOString(), rows.certificate.date.toISOString());
      assert.equal(rows.counterparties.length, 5);
      assert.equal(rows.staff.length, 3);
      assert.deepEqual(rows.claims.map(row => row.status), ['PENDING_APPROVAL', 'READY_FOR_PAYMENT', 'PAID']);
      assert.deepEqual(rows, demoSampleRows(now));
      for (const row of rows.expenses) {
        assert.match(row.amount, /^\d+\.\d{2}$/);
        if (row.sourceClaimKey) {
          const claim = rows.claims.find(claim => claim.key === row.sourceClaimKey)!;
          assert.equal(row.amount, claim.amount);
          assert.equal(row.date.toISOString(), claim.date.toISOString());
        }
      }
    });
  }
  it('rejects an invalid creation date', () => {
    assert.throws(() => demoSampleRows(new Date(NaN)), RangeError);
  });
});
