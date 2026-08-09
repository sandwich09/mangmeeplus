import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderSubstituteReceiptPdf } from './substitute-receipt-pdf.logic';
import { renderPaymentVoucherSvg } from './payment-voucher.logic';

describe('payment voucher', () => {
  it('renders the official Thai fields, full date, and amount in words', () => {
    const svg = renderPaymentVoucherSvg({
      companyName: 'บริษัท ทดสอบ จำกัด',
      paymentDate: '2026-08-06T00:00:00.000Z',
      payeeName: 'สมหญิง ใจดี',
      payeeAddress: '1 ถนนทดสอบ กรุงเทพมหานคร',
      payeeTaxId: '1234567890123',
      expenseDescription: 'ซื้อผักสด',
      amount: '65.25',
    }).toString('utf8');

    assert.match(svg, /ใบสำคัญรับเงิน/);
    assert.match(svg, /6 สิงหาคม 2569/);
    assert.match(svg, /หกสิบห้าบาทยี่สิบห้าสตางค์/);
    assert.match(svg, /1-2345-67890-12-3/);
    assert.match(svg, /data-field="payee-name"[\s\S]*สมหญิง ใจดี[\s\S]*<line/);
  });

  it('draws ruled blanks for missing payee values without null-like text', () => {
    const svg = renderPaymentVoucherSvg({
      companyName: 'บริษัท ทดสอบ จำกัด',
      paymentDate: null,
      payeeName: null,
      payeeAddress: null,
      payeeTaxId: null,
      expenseDescription: 'ค่าแรงรายวัน',
      amount: '500.00',
    }).toString('utf8');

    for (const field of ['payment-date', 'payee-name', 'payee-address', 'payee-tax-id']) {
      const group = new RegExp(`<g data-field="${field}">([\\s\\S]*?)</g>`).exec(svg)?.[1] ?? '';
      assert.match(group, /<line/);
    }
    assert.doesNotMatch(svg, /null|undefined/);
  });

  it('wraps a long payee address instead of running past the ruled line', () => {
    // This sheet prints at 18px but reuses the substitute receipt's 15px-calibrated text
    // helpers, so an unwrapped address used to run ~120px past its rule and off the page.
    const address = 'เลขที่ 199/45 อาคารเอ็มไพร์ทาวเวอร์ ชั้น 32 ถนนสาทรใต้ แขวงยานนาวา เขตสาทร กรุงเทพมหานคร 10120';
    const svg = renderPaymentVoucherSvg({
      companyName: 'บริษัท ทดสอบ จำกัด',
      paymentDate: '2026-08-06T00:00:00.000Z',
      payeeName: 'สมหญิง ใจดี',
      payeeAddress: address,
      payeeTaxId: '1234567890123',
      expenseDescription: 'ค่าบริการบำรุงรักษาระบบปรับอากาศและระบบระบายอากาศประจำไตรมาสที่ 3 ปีงบประมาณ 2569',
      amount: '65.25',
    }).toString('utf8');

    const group = /<g data-field="payee-address">([\s\S]*?)<\/g>/.exec(svg)?.[1] ?? '';
    const printed = [...group.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((match) => match[1]!);
    assert.ok(printed.length > 2, `the address should wrap onto its own ruled lines, got ${JSON.stringify(printed)}`);
    // The label is printed first; the rest is the wrapped value. Each wrapped line is trimmed,
    // so compare with whitespace removed — no character of the address may be lost.
    const strip = (value: string) => value.replace(/\s+/g, '');
    assert.equal(strip(printed.slice(1).join('')), strip(address));
  });

  it('carries enough rendered ink to pass the existing PDF guard', async () => {
    const svg = renderPaymentVoucherSvg({
      companyName: 'บริษัท ทดสอบ จำกัด',
      paymentDate: null,
      payeeName: null,
      payeeAddress: null,
      payeeTaxId: null,
      expenseDescription: 'ค่าแรงรายวัน',
      amount: '500.00',
    });
    const pdf = await renderSubstituteReceiptPdf(svg);
    assert.ok(pdf.subarray(0, 5).equals(Buffer.from('%PDF-')));
  });
});
