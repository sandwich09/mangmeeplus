import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EMPLOYEE_TITLE_PREFIXES, employeeFullName, isRoleEditableByCompany, NON_EDITABLE_ROLE_KEYS, THAI_SYSTEM_ROLE_NAMES } from './employee-access.js';

it('names COMPANY_VIEW as a company viewer, distinct from the owner', () => {
  assert.equal(THAI_SYSTEM_ROLE_NAMES.COMPANY_VIEW, 'ผู้ดูภาพรวมบริษัท');
  assert.notEqual(THAI_SYSTEM_ROLE_NAMES.COMPANY_VIEW, THAI_SYSTEM_ROLE_NAMES.OWNER);
});

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

// UAT 2026-08-15: คำนำหน้า used to live inside displayName with no separator, so every reader had
// to guess it back out and a name like นายก lost its first characters. It is its own field now.
describe('employeeFullName', () => {
  it('composes the title with the name for records written after the split', () => {
    assert.equal(employeeFullName({ titlePrefix: 'นางสาว', displayName: 'มีนา ใจงาม' }), 'นางสาวมีนา ใจงาม');
  });

  it('omits the title rather than guessing one when the record has none', () => {
    // Rows written before the split, and owners, who have no employee profile at all.
    assert.equal(employeeFullName({ displayName: 'นายมีนา ใจงาม' }), 'นายมีนา ใจงาม');
    assert.equal(employeeFullName({ displayName: 'มีนา ใจงาม' }), 'มีนา ใจงาม');
  });

  it('keeps a name that begins with a title intact, which the old concatenation could not', () => {
    assert.equal(employeeFullName({ titlePrefix: 'นาย', displayName: 'นายก สมชาย' }), 'นายนายก สมชาย');
    // The point: the stored name still reads นายก, so nothing was eaten on the way in.
    assert.equal(employeeFullName({ displayName: 'นายก สมชาย' }), 'นายก สมชาย');
  });

  it('offers exactly the titles the employee form can choose', () => {
    assert.deepEqual([...EMPLOYEE_TITLE_PREFIXES], ['นาย', 'นาง', 'นางสาว']);
  });
});
