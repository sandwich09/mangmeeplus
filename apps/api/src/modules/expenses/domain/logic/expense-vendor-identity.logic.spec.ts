// CON-8 and §6: the branch code had no validation anywhere, while the sell-side contract already
// reads `'00000'` as head office. The danger is not a rejected form, it is a stored `'00000'` that
// nobody typed — the vendor matcher would then treat "no branch printed" and "head office branch"
// as the same fact for some rows and not others.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expenseVendorIdentityFields, EXPENSE_VENDOR_ADDRESS_MAX_LENGTH } from './expense-vendor-identity.logic';

describe('expense vendor identity fields', () => {
  it('leaves untouched every field the save did not mention', () => {
    assert.deepEqual(expenseVendorIdentityFields({}), { fields: {}, error: null });
  });

  it('stores a blank branch code as null, never as an empty string or 00000 (CON-8)', () => {
    for (const blank of ['', '   ', null]) {
      assert.deepEqual(expenseVendorIdentityFields({ vendorBranchCodeSnapshot: blank }),
        { fields: { vendorBranchCodeSnapshot: null }, error: null });
    }
  });

  it('accepts exactly five digits, head office included', () => {
    for (const code of ['00000', '00001', '12345']) {
      assert.deepEqual(expenseVendorIdentityFields({ vendorBranchCodeSnapshot: ` ${code} ` }),
        { fields: { vendorBranchCodeSnapshot: code }, error: null });
    }
  });

  // The vendor matcher folds Thai numerals before comparing, so storage has to fold them too or a
  // branch typed off a Thai-numeral receipt would never match the row it created.
  it('reads Thai numerals as the digits they are', () => {
    assert.deepEqual(expenseVendorIdentityFields({ vendorBranchCodeSnapshot: '๐๐๐๐๑' }),
      { fields: { vendorBranchCodeSnapshot: '00001' }, error: null });
  });

  it('refuses anything that is not five digits, and says how to fix it', () => {
    for (const invalid of ['0000', '123456', '0000A', 'สาขา1', '00-01']) {
      const { fields, error } = expenseVendorIdentityFields({ vendorBranchCodeSnapshot: invalid });
      assert.equal(error?.code, 'EXPENSE_VENDOR_BRANCH_CODE_INVALID');
      assert.ok(error!.message.includes('5 หลัก'), 'the message must name the rule, not just refuse');
      assert.deepEqual(fields, {}, 'nothing is persisted from a refused save');
    }
  });

  // The same rule as the matcher's `normalizeBranchCode` (Phase 2a), with one difference that is
  // deliberate: a matcher may normalize a malformed code to null in silence, a form may not (D5).
  it('refuses rather than silently storing null for a code someone typed', () => {
    assert.equal(expenseVendorIdentityFields({ vendorBranchCodeSnapshot: '0001' }).fields.vendorBranchCodeSnapshot, undefined);
    assert.equal(expenseVendorIdentityFields({ vendorBranchCodeSnapshot: '' }).error, null);
  });

  it('keeps an address up to the column limit and refuses one past it without truncating (§8)', () => {
    const exact = 'ก'.repeat(EXPENSE_VENDOR_ADDRESS_MAX_LENGTH);
    assert.deepEqual(expenseVendorIdentityFields({ vendorAddressSnapshot: exact }),
      { fields: { vendorAddressSnapshot: exact }, error: null });

    const { fields, error } = expenseVendorIdentityFields({ vendorAddressSnapshot: `${exact}ก` });
    assert.equal(error?.code, 'EXPENSE_VENDOR_ADDRESS_TOO_LONG');
    assert.ok(error!.message.includes('ตัดให้สั้นลง'), 'every refusal carries a way forward (§8)');
    assert.deepEqual(fields, {});
  });

  it('trims the address and stores a blank one as null', () => {
    assert.deepEqual(expenseVendorIdentityFields({ vendorAddressSnapshot: '  123/4 ถนนสุขุมวิท กรุงเทพมหานคร 10110  ' }),
      { fields: { vendorAddressSnapshot: '123/4 ถนนสุขุมวิท กรุงเทพมหานคร 10110' }, error: null });
    assert.deepEqual(expenseVendorIdentityFields({ vendorAddressSnapshot: '   ' }),
      { fields: { vendorAddressSnapshot: null }, error: null });
  });
});
