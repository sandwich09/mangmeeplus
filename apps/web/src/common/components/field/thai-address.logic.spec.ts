import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ThaiAddressOption } from '@watchdog-bms/contracts';
import { autofillThaiAddress } from './thai-address.logic';

const row = (subdistrictTh: string): ThaiAddressOption => ({
  postalCode: '10330', provinceCode: '10', provinceTh: 'กรุงเทพมหานคร',
  districtCode: '1033', districtTh: 'ปทุมวัน', subdistrictCode: subdistrictTh, subdistrictTh,
});

describe('autofillThaiAddress', () => {
  it('fills a unique postal code, province and district but leaves an ambiguous subdistrict to choose', () => {
    assert.deepEqual(autofillThaiAddress(
      { postalCode: '103', province: '', district: '', subdistrict: '' },
      [row('ลุมพินี'), row('รองเมือง')],
    ), { postalCode: '10330', province: 'กรุงเทพมหานคร', district: 'ปทุมวัน', subdistrict: '' });
  });

  it('preserves an existing saved selection', () => {
    const value = { postalCode: '10330', province: 'กรุงเทพมหานคร', district: 'ปทุมวัน', subdistrict: 'ลุมพินี' };
    assert.deepEqual(autofillThaiAddress(value, [row('ลุมพินี')]), value);
  });
});
