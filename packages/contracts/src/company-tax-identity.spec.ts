// BUG-1 golden vectors. `Company.addressJson` is a Json column, so this formatter is the single
// place that decides what a document prints for the company's own address — and every caller of it
// is a statutory artifact (50 ทวิ, ใบรับรองแทนใบเสร็จ) where `{"line1":"…"}` is a defect a user sees.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCompanyLegalAddress, type CompanyLegalAddress } from './company-tax-identity.js';

const full: CompanyLegalAddress = {
  line1: '123/4 หมู่ 5 ถนนสุขุมวิท',
  line2: 'อาคารตัวอย่าง ชั้น 12',
  subdistrict: 'คลองเตย',
  district: 'คลองเตย',
  province: 'กรุงเทพมหานคร',
  postalCode: '10110',
};

describe('formatCompanyLegalAddress', () => {
  it('prints one line in เลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์ order', () => {
    assert.equal(formatCompanyLegalAddress(full),
      '123/4 หมู่ 5 ถนนสุขุมวิท อาคารตัวอย่าง ชั้น 12 คลองเตย คลองเตย กรุงเทพมหานคร 10110');
  });

  it('skips a blank or absent part instead of printing a gap', () => {
    assert.equal(formatCompanyLegalAddress({ ...full, line2: null }),
      '123/4 หมู่ 5 ถนนสุขุมวิท คลองเตย คลองเตย กรุงเทพมหานคร 10110');
    assert.equal(formatCompanyLegalAddress({ ...full, line2: '   ' }),
      '123/4 หมู่ 5 ถนนสุขุมวิท คลองเตย คลองเตย กรุงเทพมหานคร 10110');
    const { line2: _line2, ...withoutLine2 } = full;
    assert.equal(formatCompanyLegalAddress(withoutLine2),
      '123/4 หมู่ 5 ถนนสุขุมวิท คลองเตย คลองเตย กรุงเทพมหานคร 10110');
  });

  it('prints what it has when the company has filled in only part of the address', () => {
    assert.equal(formatCompanyLegalAddress({ line1: '123/4', province: 'เชียงใหม่' } as CompanyLegalAddress),
      '123/4 เชียงใหม่');
  });

  it('answers null for anything that is not a usable address, never throws', () => {
    for (const unusable of [null, undefined, {}, { line1: '   ' }, { line1: 42, province: true },
      ['123/4', 'กรุงเทพมหานคร'], '123/4 ถนนสุขุมวิท กรุงเทพ', 42] as unknown as CompanyLegalAddress[]) {
      assert.equal(formatCompanyLegalAddress(unusable), null);
    }
  });
});
