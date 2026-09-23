import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import type { PayeeSnapshot, PayerSnapshot } from '@watchdog-bms/contracts';
import { renderWhtCertificatePdf, type WhtCertificateFields } from './wht-certificate-pdf.logic';

const payer: PayerSnapshot = {
  companyName: 'บริษัท มั่งมีกิจทดสอบ จำกัด', taxId: '0105569135722', branchCode: null,
  address: JSON.stringify({ line1: '123/219 ถนนพระรามสอง', line2: null, subdistrict: 'สามเสนใน', district: 'พญาไท', province: 'กรุงเทพมหานคร', postalCode: '10400' }),
};
const payee: PayeeSnapshot = {
  name: 'บริษัท ผู้รับเงินทดสอบ จำกัด', taxId: '0105563047775', branchCode: null,
  address: JSON.stringify({ line1: '123 ถนนสุขุมวิท', subdistrict: 'คลองตันเหนือ', district: 'วัฒนา', province: 'กรุงเทพมหานคร', postalCode: '10110' }),
};
const fields: WhtCertificateFields = {
  certificateNumber: 'WHT-2026-00001', formType: 'PND53',
  incomeCategoryCode: 'WHT_SERVICE_5', incomeCategoryName: 'ค่าบริการ (นิติบุคคล)',
  whtRate: '3', grossAmount: '10000.00', withheldAmount: '300.00',
  paymentDate: '2026-09-23T00:00:00.000Z', issuedAt: '2026-09-23T00:00:00.000Z',
};

describe('Revenue Department 50 ทวิ PDF', () => {
  it('prints both statutory copies on A4 with the official labels, without form widgets or raw address JSON', async () => {
    const bytes = await renderWhtCertificatePdf(fields, payer, payee);
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 2);
    assert.equal(pdf.getTitle(), fields.certificateNumber);
    for (const page of pdf.getPages()) {
      assert.equal(Math.round(page.getWidth()), 595);
      assert.equal(Math.round(page.getHeight()), 842);
      assert.equal(String(page.node.get(PDFName.of('Annots'))), '[ ]');
    }
    assert.ok(!bytes.includes(Buffer.from('"line1"')), 'serialized address must never be printed');
  });

  it('renders replacement and superseded state without losing the official form', async () => {
    const bytes = await renderWhtCertificatePdf(fields, payer, payee, { mode: 'BLANK' }, { issuedAt: '2026-09-24T00:00:00Z' }, { stateStamp: 'SUPERSEDED' });
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 2);
    assert.equal(pdf.getSubject(), 'State: SUPERSEDED');
  });

  it('fails safely if a legacy address is malformed JSON', async () => {
    await assert.rejects(renderWhtCertificatePdf(fields, { ...payer, address: '{"line1":' }, payee), /invalid JSON/);
  });
});
