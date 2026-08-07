import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pageBounds } from './paging.logic';

describe('pageBounds', () => {
  it('returns an empty first page for an empty list', () => {
    assert.deepEqual(pageBounds(0, 1), { totalPages: 1, page: 1, start: 0, end: 0, from: 0, to: 0 });
  });

  it('handles exact and partial last pages', () => {
    assert.deepEqual(pageBounds(20, 2), { totalPages: 2, page: 2, start: 10, end: 20, from: 11, to: 20 });
    assert.deepEqual(pageBounds(25, 3), { totalPages: 3, page: 3, start: 20, end: 25, from: 21, to: 25 });
  });

  it('clamps pages above and below the available range', () => {
    assert.deepEqual(pageBounds(25, 99), { totalPages: 3, page: 3, start: 20, end: 25, from: 21, to: 25 });
    assert.deepEqual(pageBounds(25, 0), { totalPages: 3, page: 1, start: 0, end: 10, from: 1, to: 10 });
  });
});
