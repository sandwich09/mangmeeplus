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
