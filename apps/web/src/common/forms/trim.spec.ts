import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { trimValues, trimmed } from './trim';

describe('trim helpers', () => {
  it('trims leading and trailing whitespace', () => {
    assert.equal(trimmed('  นภา วงศ์ทอง '), 'นภา วงศ์ทอง');
  });

  it('trims only string values in an object', () => {
    assert.deepEqual(
      trimValues({ displayName: ' มายด์ ', phoneNumber: ' 0812345678 ', roleIds: [' r1 '], active: true }),
      { displayName: 'มายด์', phoneNumber: '0812345678', roleIds: [' r1 '], active: true },
    );
  });
});
