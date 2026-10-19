import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { listBranches, type Branch } from './branches.api';

for (const total of [0, 100, 205]) test(`FIX-Q1 branch listing reads every page and retains closed branches for settings: ${total}`, async () => {
  const original = globalThis.fetch;
  const rows = Array.from({ length: total }, (_, i) => ({ id: String(i), status: i === 1 ? 'DISABLED' : i === 2 ? 'ARCHIVED' : 'ACTIVE' } as Branch));
  const pages: number[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input), 'https://local.test');
    const page = Number(url.searchParams.get('page') ?? 1);
    pages.push(page);
    assert.equal(url.searchParams.get('pageSize'), '100');
    assert.equal(url.searchParams.get('status'), null);
    return new Response(JSON.stringify({ items: rows.slice((page - 1) * 100, page * 100), total, page, pageSize: 100 }));
  };
  try {
    assert.deepEqual(await listBranches('shop'), rows);
    assert.deepEqual(pages, Array.from({ length: Math.max(1, Math.ceil(total / 100)) }, (_, i) => i + 1));
  } finally { globalThis.fetch = original; }
});

test('FIX-Q1 a later branch page failure is reported instead of returning an incomplete list', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => String(input).includes('page=2')
    ? new Response('{}', { status: 500 })
    : new Response(JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })), total: 101, page: 1, pageSize: 100 }));
  try { await assert.rejects(listBranches('shop')); }
  finally { globalThis.fetch = original; }
});

test('FIX-Q1 every employee branch picker excludes disabled and archived branches', () => {
  for (const file of ['EmployeeAccessPages', 'IndividualPermissionsPrototypePage', 'AddEmployeePrototypePage']) {
    const source = readFileSync(new URL(`../employee-access/${file}.tsx`, import.meta.url), 'utf8');
    assert.match(source, /setBranches\([^;]*filter\(\(?branch\)? => branch.status === 'ACTIVE'\)/, file);
  }
});
