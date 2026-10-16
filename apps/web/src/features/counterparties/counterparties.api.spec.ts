import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mutable } from '../expenses/expense-certificate-test-harness';
const fetch = mutable('@/common/api/authed-fetch');
const { listCounterparties } = require('./counterparties.api');

test('counterparty list requests ten rows and keeps each server filter and optional tab counts', async () => {
  const calls: string[] = [];
  const result = { data: [], total: 7, counts: { all: 7, bought: 4, sold: 2, addressMissing: 1 } };
  const request = mock.method(fetch, 'authedApiFetch', async (path: string) => { calls.push(path); return result; });
  try {
    for (const filter of ['all', 'bought', 'sold', 'addressMissing']) {
      assert.equal(await listCounterparties('co', { page: 2, search: 'ร้าน', filter }), result);
      const url = new URL(calls.at(-1)!, 'http://local');
      assert.equal(url.pathname, '/companies/co/accounting/counterparties');
      assert.equal(url.searchParams.get('pageSize'), '10');
      assert.equal(url.searchParams.get('page'), '2');
      assert.equal(url.searchParams.get('search'), 'ร้าน');
      assert.equal(url.searchParams.get('usage'), filter === 'bought' || filter === 'sold' ? filter : null);
      assert.equal(url.searchParams.get('addressMissing'), filter === 'addressMissing' ? 'true' : null);
    }
  } finally { request.mock.restore(); }
});
