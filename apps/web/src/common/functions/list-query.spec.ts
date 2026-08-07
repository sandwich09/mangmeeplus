import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serializeListQuery, deserializeListQuery } from './list-query';

describe('list-query', () => {
  it('empty query serializes to empty URLSearchParams', () => {
    const params = serializeListQuery({});
    assert.strictEqual([...params.entries()].length, 0);
  });

  it('search round-trips', () => {
    const q = { search: 'hello' };
    const result = deserializeListQuery(serializeListQuery(q));
    assert.strictEqual(result.search, 'hello');
  });

  it('search + sort round-trips', () => {
    const q = { search: 'test', sortBy: 'name', sortDir: 'asc' as const };
    const result = deserializeListQuery(serializeListQuery(q));
    assert.strictEqual(result.search, 'test');
    assert.strictEqual(result.sortBy, 'name');
    assert.strictEqual(result.sortDir, 'asc');
  });

  it('filters with scalar values round-trips', () => {
    const q = { filters: { status: 'active' } };
    const result = deserializeListQuery(serializeListQuery(q));
    assert.deepStrictEqual(result.filters, { status: 'active' });
  });

  it('filters with array values round-trips', () => {
    const q = { filters: { tag: ['a', 'b', 'c'] } };
    const result = deserializeListQuery(serializeListQuery(q));
    assert.deepStrictEqual(result.filters, { tag: ['a', 'b', 'c'] });
  });

  it('page and pageSize are parsed as integers', () => {
    const q = { page: 3, pageSize: 25 };
    const result = deserializeListQuery(serializeListQuery(q));
    assert.strictEqual(result.page, 3);
    assert.strictEqual(result.pageSize, 25);
  });

  it('cursor round-trips', () => {
    const q = { cursor: 'abc123' };
    const result = deserializeListQuery(serializeListQuery(q));
    assert.strictEqual(result.cursor, 'abc123');
  });

  it('sortDir only accepts asc|desc, ignores invalid values', () => {
    const params = new URLSearchParams({ sortDir: 'random' });
    const result = deserializeListQuery(params);
    assert.strictEqual(result.sortDir, undefined);
  });

  it('desc sortDir round-trips', () => {
    const q = { sortDir: 'desc' as const };
    const result = deserializeListQuery(serializeListQuery(q));
    assert.strictEqual(result.sortDir, 'desc');
  });
});
