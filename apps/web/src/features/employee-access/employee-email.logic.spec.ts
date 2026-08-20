import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isEmployeeEmail } from './employee-email.logic';

describe('employee email', () => {
  it('accepts a normal address', () => {
    assert.equal(isEmployeeEmail('employee@example.com'), true);
  });

  it('rejects the invalid top-level domain before the API does', () => {
    assert.equal(isEmployeeEmail('asuad@test.ci21d'), false);
  });
});
