import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { consumeStoredNoticeOnce } from './expense-notice.logic';

describe('consumeStoredNoticeOnce', () => {
  it('retains a consumed notice through a StrictMode effect replay', () => {
    const values = new Map([['notice:expense-1', JSON.stringify({ tone: 'info', message: 'ครบ 3 ใบ', persistent: true })]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); } };
    const consumed = { current: null as string | null };
    const first = consumeStoredNoticeOnce<{ tone: string; message: string; persistent?: boolean }>(storage, 'notice:expense-1', 'expense-1', consumed);
    const replay = consumeStoredNoticeOnce(storage, 'notice:expense-1', 'expense-1', consumed);
    assert.deepEqual(first, { tone: 'info', message: 'ครบ 3 ใบ', persistent: true });
    assert.equal(replay, undefined);
  });

  it('consumes the next expense notice', () => {
    const values = new Map([['notice:expense-2', JSON.stringify({ tone: 'info', message: 'second' })]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); } };
    const consumed = { current: 'expense-1' as string | null };
    assert.deepEqual(consumeStoredNoticeOnce(storage, 'notice:expense-2', 'expense-2', consumed), { tone: 'info', message: 'second' });
  });
});
