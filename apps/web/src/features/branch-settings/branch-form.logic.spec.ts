import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { taxBranchCodeError } from './branch-form.logic';

describe('taxBranchCodeError', () => {
  it('accepts an omitted code or exactly five ASCII digits', () => {
    for (const value of [undefined, null, '', '   ', '00000', ' 00001 ']) assert.equal(taxBranchCodeError(value), null);
  });

  it('rejects short, long and non-digit values before submitting', () => {
    for (const value of ['123', '123456', '12A45', '๑๒๓๔๕']) assert.match(taxBranchCodeError(value) ?? '', /5 หลัก/);
  });
});
