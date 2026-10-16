// BUG-1 golden vectors. `Company.addressJson` is a Json column, so this formatter is the single
// place that decides what a document prints for the company's own address — and every caller of it
// is a statutory artifact (50 ทวิ, ใบรับรองแทนใบเสร็จ) where `{"line1":"…"}` is a defect a user sees.
import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCompanyLegalAddress, formatCompanyLegalAddressForPrint, thaiTaxIdChecksumValid, type CompanyLegalAddress } from './company-tax-identity.js';

const full: CompanyLegalAddress = {
  line1: '123/4 หมู่ 5 ถนนสุขุมวิท',
  line2: 'อาคารตัวอย่าง ชั้น 12',
  subdistrict: 'คลองเตย',
  district: 'คลองเตย',
  province: 'กรุงเทพมหานคร',
  postalCode: '10110',
};

describe('thaiTaxIdChecksumValid', () => {
  it('checks the Thai 13-digit check digit without treating invalid legacy payees as blockers', () => {
    assert.equal(thaiTaxIdChecksumValid('0994000165676'), true);
    assert.equal(thaiTaxIdChecksumValid('0994000165677'), false);
    assert.equal(thaiTaxIdChecksumValid('099400016567'), false);
    assert.equal(thaiTaxIdChecksumValid('0105566070001'), false); // seeded vendor; genuinely fails the check digit
  });
});

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


test('certificate payee address trims the typed value first, then the snapshot, and returns null for a blank print', async () => {
  const { whtPayeeAddress } = await import('./tax.js');
  assert.equal(whtPayeeAddress('  พิมพ์เอง  ', 'ต้นทาง'), 'พิมพ์เอง');
  assert.equal(whtPayeeAddress('  ', '  ต้นทาง  '), 'ต้นทาง');
  for (const value of [null, undefined, '', '  ']) assert.equal(whtPayeeAddress(value, value), null);
});


test('payer identity fills only printable blanks, preserves frozen values and reports both missing fields', async () => {
  const { whtPayerIdentity } = await import('./tax.js');
  const frozen = { companyName: 'กิจการเดิม', taxId: null, address: null, branchCode: '00002' };
  const current = { registeredName: 'กิจการเดิม', taxId: '1234567890123', address: 'ที่อยู่ปัจจุบัน' };
  assert.deepEqual(whtPayerIdentity(frozen, current), { payer: { ...frozen, taxId: current.taxId, address: current.address }, missing: [] });
  assert.deepEqual(frozen, { companyName: 'กิจการเดิม', taxId: null, address: null, branchCode: '00002' });
  const filled = { ...frozen, taxId: '9999999999999', address: 'ที่อยู่เดิม' };
  assert.deepEqual(whtPayerIdentity(filled, current), { payer: filled, missing: [] });
  assert.deepEqual(whtPayerIdentity(frozen, { registeredName: 'กิจการเดิม', taxId: null, address: null }).missing, ['TAX_ID', 'ADDRESS']);
  // A frozen tax number that cannot be printed is replaced by the shop's current one, never left as a dead end.
  assert.deepEqual(whtPayerIdentity({ ...filled, taxId: '123' }, current), { payer: { ...filled, taxId: current.taxId }, missing: [] });
  assert.deepEqual(whtPayerIdentity({ ...filled, taxId: '123' }, { registeredName: 'กิจการเดิม', taxId: null, address: null }).missing, ['TAX_ID']);
  assert.deepEqual(whtPayerIdentity({ ...filled, address: '{}' }, current).payer.address, current.address);
  const json = JSON.stringify({ line1: 'บ้านเลขที่ 1' });
  assert.equal(whtPayerIdentity({ ...filled, address: json }, current).payer.address, json);
});


test('both certificate identity refusals name the shared print action', async () => {
  const { WHT_PRINT_CERTIFICATE_LABEL, WHT_HANDOFF_PAYEE_ADDRESS_MISSING_MESSAGE, whtPayerIdentityMissingMessage } = await import('./tax.js');
  assert.equal(WHT_PRINT_CERTIFICATE_LABEL, 'ออกหนังสือรับรอง 50 ทวิ');
  for (const message of [WHT_HANDOFF_PAYEE_ADDRESS_MISSING_MESSAGE, whtPayerIdentityMissingMessage(['TAX_ID']), whtPayerIdentityMissingMessage(['ADDRESS']), whtPayerIdentityMissingMessage(['TAX_ID', 'ADDRESS'])]) {
    assert.ok(message.endsWith(`แล้วกด “${WHT_PRINT_CERTIFICATE_LABEL}” อีกครั้ง`));
  }
});

describe('formatCompanyLegalAddressForPrint', () => {
  it('words the sub-district and district of a Bangkok address and leaves the province bare', () => {
    assert.equal(formatCompanyLegalAddressForPrint({ line1: '88 ถนนพระราม 4', line2: null, subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' }),
      '88 ถนนพระราม 4 แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110');
  });
  it('words all three parts of an address outside Bangkok', () => {
    assert.equal(formatCompanyLegalAddressForPrint({ line1: '9 หมู่ 2', line2: 'อาคารดอย', subdistrict: 'สุเทพ', district: 'เมืองเชียงใหม่', province: 'เชียงใหม่', postalCode: '50200' }),
      '9 หมู่ 2 อาคารดอย ตำบลสุเทพ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200');
  });
  it('never doubles a word the stored part already carries, in full or abbreviated', () => {
    assert.equal(formatCompanyLegalAddressForPrint({ line1: '1', subdistrict: 'แขวงสีลม', district: 'เขตบางรัก', province: 'กรุงเทพฯ', postalCode: '10500' }),
      '1 แขวงสีลม เขตบางรัก กรุงเทพฯ 10500');
    assert.equal(formatCompanyLegalAddressForPrint({ line1: '1', subdistrict: 'ต.ในเมือง', district: 'อ.เมือง', province: 'จ.ขอนแก่น', postalCode: '40000' }),
      '1 ต.ในเมือง อ.เมือง จ.ขอนแก่น 40000');
  });
  it('skips blank parts and answers null exactly when the bare formatter does', () => {
    assert.equal(formatCompanyLegalAddressForPrint({ line1: '5 ถนนกลาง', subdistrict: ' ', district: '', province: 'ระยอง', postalCode: '21000' } as CompanyLegalAddress), '5 ถนนกลาง จังหวัดระยอง 21000');
    for (const bad of [null, undefined, [] as unknown as CompanyLegalAddress, {} as CompanyLegalAddress, 'x' as unknown as CompanyLegalAddress]) {
      assert.equal(formatCompanyLegalAddressForPrint(bad), null); assert.equal(formatCompanyLegalAddress(bad), null);
    }
  });
  it('leaves the bare formatter exactly as it was', () => {
    assert.equal(formatCompanyLegalAddress({ line1: '88 ถนนพระราม 4', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' }),
      '88 ถนนพระราม 4 คลองเตย คลองเตย กรุงเทพมหานคร 10110');
  });
});
test('payer refusals use the shop profile words for each missing detail', async () => {
  const { whtPayerMissingLabel, whtPayerIdentityMissingMessage } = await import('./tax.js');
  for (const [missing, words] of [[['TAX_ID'], 'เลขผู้เสียภาษีของร้าน'], [['ADDRESS'], 'ที่อยู่ของร้าน'], [['TAX_ID', 'ADDRESS'], 'เลขผู้เสียภาษีและที่อยู่ของร้าน']] as const) {
    assert.equal(whtPayerMissingLabel(missing), words);
    assert.equal(whtPayerIdentityMissingMessage(missing), `ยังไม่มี${words} กรอกในหน้าข้อมูลร้านก่อน แล้วกด “ออกหนังสือรับรอง 50 ทวิ” อีกครั้ง`);
  }
});


it('labels an address cleared for a changed payee tax number in certificate history', async () => {
  const { WHT_CERTIFICATE_HISTORY_EVENT_LABELS } = await import('./tax.js');
  assert.equal(WHT_CERTIFICATE_HISTORY_EVENT_LABELS.PAYEE_ADDRESS_CLEARED, 'ล้างที่อยู่ผู้รับเงิน เพราะเลขผู้เสียภาษีเปลี่ยน');
});

test('registered payer identity checks every missing combination and never trusts a frozen display name', async () => {
  const { whtPayerIdentity, whtPayerMissingLabel } = await import('./tax.js');
  const fields = ['REGISTERED_NAME', 'TAX_ID', 'ADDRESS'] as const;
  const labels = ['ชื่อจดทะเบียน', 'เลขผู้เสียภาษี', 'ที่อยู่'];
  for (let mask = 0; mask < 8; mask++) {
    const current = { registeredName: mask & 1 ? null : ' ชื่อจดทะเบียนจริง ', taxId: mask & 2 ? null : '1234567890123', address: mask & 4 ? null : 'บ้านเลขที่ 1' };
    const result = whtPayerIdentity({ companyName: 'Display name', taxId: null, address: null, branchCode: null }, current);
    const missing = fields.filter((_, index) => mask & (1 << index));
    assert.deepEqual(result.missing, missing);
    assert.equal(result.payer.companyName, mask & 1 ? '' : 'ชื่อจดทะเบียนจริง');
    if (missing.length) {
      const words = labels.filter((_, index) => mask & (1 << index));
      const expected = words.length === 3 ? `${words[0]} ${words[1]} และ${words[2]}` : words.join('และ');
      assert.equal(whtPayerMissingLabel(missing), `${expected}ของร้าน`);
    }
  }
});
