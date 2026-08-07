import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRoleEditableByCompany, NON_EDITABLE_ROLE_KEYS } from './employee-access.js';

describe('isRoleEditableByCompany', () => {
  it('rejects every platform-managed role key', () => {
    for (const key of NON_EDITABLE_ROLE_KEYS) {
      assert.equal(isRoleEditableByCompany({ key }), false);
    }
  });

  it('allows company-editable role keys', () => {
    assert.equal(isRoleEditableByCompany({ key: 'ADMIN' }), true);
  });
});
