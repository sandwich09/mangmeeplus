/**
 * oracle.ts mostly boots the real, compiled API (DB, Nest application context) — not something a
 * fast unit test should touch. `resolveGoldCallInput` (and the `$fromShownItems`/`$period` marker
 * resolution it does) is a pure, DB-free exception, and directly implicated in the T-068 bug
 * (run-real.ts scored a gold call's UNRESOLVED `{ $fromShownItems: 2 }` marker against the model's
 * resolved id string — this file pins the resolution this function must keep producing so that bug
 * cannot silently come back).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveGoldCallInput, extractExpectedFacts, type ShownItem } from './oracle';
import type { GoldCall } from './types';

const NOW = new Date('2026-09-27T06:00:00.000Z'); // 13:00 Bangkok, 27 Sep 2026

const shownItems: ShownItem[] = [
  { index: 0, id: 'expense-company-a-15', date: '2026-09-16T04:00:00.000Z', label: 'ร้านสมใจการค้า' },
  { index: 1, id: 'expense-company-a-14', date: '2026-09-15T04:00:00.000Z', label: 'ร้านสมใจ' },
  { index: 2, id: 'expense-company-a-13', date: '2026-09-14T04:00:00.000Z', label: 'ไม่ระบุร้าน' },
];

describe('resolveGoldCallInput', () => {
  it('passes plain literal values through unchanged', () => {
    const call: GoldCall = { tool: 'expense.list_recent', input: { documentStatus: 'CONFIRMED', limit: 5 } };
    assert.deepEqual(resolveGoldCallInput(call, NOW, []), { documentStatus: 'CONFIRMED', limit: 5 });
  });

  it('spreads a { $period } marker into sibling fromDate/toDate keys, dropping the wrapper key', () => {
    const call: GoldCall = { tool: 'expense.list_recent', input: { period: { $period: 'this_month_to_date' } } };
    const resolved = resolveGoldCallInput(call, NOW, []);
    assert.deepEqual(resolved, { fromDate: '2026-09-01', toDate: '2026-09-27' });
    assert.ok(!('period' in resolved), 'the "period" wrapper key must not survive resolution');
  });

  it('resolves a { $fromShownItems } marker to that shown item\'s id (T-068)', () => {
    // "รายการที่ 3 คือร้านอะไร" after a list turn that showed [-15, -14, -13] — item 3 is index 2.
    const call: GoldCall = { tool: 'expense.get_detail', input: { expenseId: { $fromShownItems: 2 } } };
    assert.deepEqual(resolveGoldCallInput(call, NOW, shownItems), { expenseId: 'expense-company-a-13' });
  });

  it('throws when $fromShownItems points past the end of what was actually shown', () => {
    const call: GoldCall = { tool: 'expense.get_detail', input: { expenseId: { $fromShownItems: 9 } } };
    assert.throws(() => resolveGoldCallInput(call, NOW, shownItems), /no shown item at index 9/);
  });

  it('resolves a period, a literal, and a shown-item reference together in one call', () => {
    const call: GoldCall = { tool: 'expense.list_recent', input: { period: { $period: 'today' }, documentStatus: 'CONFIRMED', expenseId: { $fromShownItems: 0 } } };
    assert.deepEqual(resolveGoldCallInput(call, NOW, shownItems), {
      fromDate: '2026-09-27', toDate: '2026-09-27', documentStatus: 'CONFIRMED', expenseId: 'expense-company-a-15',
    });
  });
});

describe('extractExpectedFacts: task item 2 (per-turn requiredFacts)', () => {
  const detailData = {
    grandTotalAmount: '2081', expenseDate: '2026-09-14T04:00:00.000Z', vendorName: 'ร้านสมใจ',
    status: 'CONFIRMED', paymentStatus: 'PARTIALLY_PAID',
  };
  const detailResult = { status: 'ok', data: detailData };

  it('detail defaults to amount+date+vendor, unchanged from before this feature (no status)', () => {
    const facts = extractExpectedFacts('expense.get_detail', detailResult);
    assert.deepEqual(new Set(facts.map((f) => f.label)), new Set(['amount', 'date', 'vendor']));
  });

  it('"รายการที่ 3 คือร้านอะไร" — requiredFacts:[\'vendor\'] narrows to just the vendor', () => {
    const facts = extractExpectedFacts('expense.get_detail', detailResult, undefined, ['vendor']);
    assert.deepEqual(facts.map((f) => f.label), ['vendor']);
    assert.equal(facts[0]!.value, 'ร้านสมใจ');
  });

  it('requiredFacts:[\'vendor\',\'date\'] keeps both and drops amount', () => {
    const facts = extractExpectedFacts('expense.get_detail', detailResult, undefined, ['vendor', 'date']);
    assert.deepEqual(new Set(facts.map((f) => f.label)), new Set(['vendor', 'date']));
  });

  it('"จ่ายหรือยัง" — requiredFacts:[\'status\'] requires every Thai synonym for the payment/document status, never amount/date/vendor', () => {
    const facts = extractExpectedFacts('expense.get_detail', detailResult, undefined, ['status']);
    const sorted = [...facts].sort((a, b) => a.label!.localeCompare(b.label!));
    assert.deepEqual(sorted.map((f) => ({ kind: f.kind, value: f.value })), [
      { kind: 'status', value: ['ยืนยันแล้ว'] }, { kind: 'status', value: ['จ่ายบางส่วน', 'ชำระบางส่วน'] },
    ]);
  });

  it('other shapes keep their own defaults unchanged too (single_metric: total+count)', () => {
    const facts = extractExpectedFacts('expense.list_recent', { status: 'ok', data: { summary: { totalAmount: '500', countedItems: 3 } } });
    assert.deepEqual(new Set(facts.map((f) => f.label)), new Set(['total', 'count']));
  });
});
