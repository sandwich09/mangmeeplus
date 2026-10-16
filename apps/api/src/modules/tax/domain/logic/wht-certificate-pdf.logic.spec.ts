import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import type { PayeeSnapshot, PayerSnapshot } from '@watchdog-bms/contracts';
import { renderWhtCertificatePdf, makeMarks, type WhtCertificateFields } from './wht-certificate-pdf.logic';

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


describe('certificate civil issue dates (E3)', () => {
  for (const [time, instant] of [['06:30', '2026-09-22T23:30:00Z'], ['23:30', '2026-09-23T16:30:00Z']]) {
    it(`prints issue and replacement dates as the Bangkok day at ${time}, preserving the payment date`, () => {
      const names = ['book_no', 'run_no', 'id1', 'id1_2', 'name1', 'name2', 'add1', 'add2', 'chk7', 'chk8', 'date14.0', 'pay1.13.0', 'tax1.13.0', 'pay1.14', 'tax1.14', 'total', 'date_pay', 'month_pay', 'year_pay'];
      const rects = new Map(names.map((name, index) => [name, { x: index * 10, y: 100, width: 100, height: 10 }]));
      const marks = makeMarks({ ...fields, issuedAt: instant!, paymentDate: '2026-09-22T00:00:00Z' }, payer, payee, rects, { issuedAt: instant! });
      const printed = (name: string) => marks.find(mark => mark.x === rects.get(name)!.x + 2)?.text;
      assert.equal(printed('date_pay'), '23'); assert.equal(printed('month_pay'), '09'); assert.equal(printed('year_pay'), '2569');
      assert.ok(marks.some(mark => mark.text === 'ใบแทน 23/09/2569'));
      assert.equal(printed('date14.0'), '22/09/2569');
    });
  }
});


it('certificate downloads have a Thai filename and unchanged PDF bytes', async () => {
  const { TaxArtifactRendererService } = await import('../../application/services/tax-artifact-renderer.service');
  const artifact = await new TaxArtifactRendererService().renderWhtCertificate(fields, payer, payee);
  assert.equal(artifact.fileName, `หนังสือรับรอง-50-ทวิ-${fields.certificateNumber}.pdf`);
  assert.equal(artifact.mimeType, 'application/pdf');
  assert.equal(Buffer.from(artifact.contentBase64, 'base64').subarray(0, 5).toString(), '%PDF-');
});

it('W6 the measured master puts payment in the income row and issue date beside the signature, 35 days apart', async () => {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const master = await PDFDocument.load(await readFile(join(__dirname, '../../assets/rd-wht50bis.pdf')));
  const rects = new Map(master.getForm().getFields().map(f => [f.getName(), f.acroField.getWidgets()[0]!.getRectangle()]));
  assert.deepEqual([rects.get('date14.0')!.x, rects.get('date14.0')!.y], [326.503, 216.34]);
  assert.deepEqual([rects.get('date_pay')!.x, rects.get('date_pay')!.y], [341.819, 72.1061]);
  for (const [issuedAt, expected] of [['2026-10-05T03:00:00Z', ['05', '10', '2569']], ['2026-11-09T03:00:00Z', ['09', '11', '2569']]] as const) {
    const marks = makeMarks({ ...fields, paymentDate: '2026-10-05', issuedAt }, payer, payee, rects);
    const printed = (name: string) => marks.find(mark => mark.x === rects.get(name)!.x + 2)?.text;
    assert.equal(printed('date14.0'), '05/10/2569');
    assert.deepEqual(['date_pay', 'month_pay', 'year_pay'].map(printed), [...expected]);
  }
});
