import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import type { PayeeSnapshot, PayerSnapshot } from '@watchdog-bms/contracts';
import { buildWhtCertificateSvg, renderWhtCertificatePdf, type WhtCertificateFields } from './wht-certificate-pdf.logic';

// The golden-fixture example transcribed in docs/agent-memory/wht-certificate-system-issuance.md
// (owner-supplied real 50 ทวิ, WT2026090002) — same values, so this spec doubles as a smoke check
// against the primary Phase 6 acceptance case's numbers.
const payerSnapshot: PayerSnapshot = {
  companyName: 'บริษัท มั่งมียั่งยืน จำกัด (สำนักงานใหญ่)',
  taxId: '0105569135722',
  branchCode: null,
  address: '123/219 หมู่ 11 แขวงบางขุนเทียน เขตจอมทอง กรุงเทพมหานคร 10150',
};
const payeeSnapshot: PayeeSnapshot = {
  name: 'บริษัท เลิฟไดร์ฟ คาร์เร้นท์ จำกัด (สำนักงานใหญ่)',
  taxId: '0105563047775',
  address: '703 ถนนวงศ์สว่าง แขวงวงศ์สว่าง เขตบางซื่อ กรุงเทพมหานคร 10800',
  branchCode: null,
};
const fields: WhtCertificateFields = {
  certificateNumber: 'WT2026090002',
  formType: 'PND53',
  incomeCategoryCode: 'CAT5',
  incomeCategoryName: 'ค่าเช่า/ค่าบริการ',
  whtRate: '5',
  grossAmount: '1000.00',
  withheldAmount: '50.00',
  paymentDate: '2026-09-12T00:00:00.000Z',
  issuedAt: '2026-09-12T00:00:00.000Z',
};

describe('buildWhtCertificateSvg', () => {
  it('includes every real 50 ทวิ field the spec requires (§6)', () => {
    const svg = buildWhtCertificateSvg(fields, payerSnapshot, payeeSnapshot).toString('utf8');
    assert.match(svg, /0-1055-69135-72-2/, 'payer tax id, formatted 13-digit');
    assert.match(svg, /0-1055-63047-77-5/, 'payee tax id, formatted 13-digit');
    assert.match(svg, /WT2026090002/, 'เล่มที่/เลขที่');
    assert.match(svg, /เลิฟไดร์ฟ/, 'payee name');
    assert.match(svg, /มั่งมียั่งยืน/, 'payer name');
    assert.match(svg, /ค่าเช่า\/ค่าบริการ/, 'incomeCategoryName');
    assert.match(svg, /1,000\.00/, 'gross amount (จำนวนเงินที่จ่าย)');
    assert.match(svg, /50\.00/, 'withheld amount (ภาษีที่หักและนำส่ง)');
    assert.match(svg, /ห้าสิบบาทถ้วน/, 'รวมเงินภาษีที่หักนำส่ง (ตัวอักษร)');
    assert.match(svg, /ภ\.ง\.ด\.53/, 'ภ.ง.ด. checkbox label present');
    assert.match(svg, /ภ\.ง\.ด\.3/, 'the other form is still labelled, just unchecked');
    assert.match(svg, /หัก ณ ที่จ่าย/, 'ผู้จ่ายเงิน checkbox');
  });

  it('checks ภ.ง.ด.53 for a juristic payee and ภ.ง.ด.3 for an individual payee — never both', () => {
    const pnd53 = buildWhtCertificateSvg(fields, payerSnapshot, payeeSnapshot).toString('utf8');
    const pnd3 = buildWhtCertificateSvg({ ...fields, formType: 'PND3' }, payerSnapshot, payeeSnapshot).toString('utf8');
    // One ✓ for the form-type checkbox and one for the fixed "(1) หัก ณ ที่จ่าย" checkbox — never
    // more (both boxes checked) or fewer (the actual class silently unchecked).
    assert.equal((pnd53.match(/✓/g) ?? []).length, 2);
    assert.equal((pnd3.match(/✓/g) ?? []).length, 2);
  });

  it('places the stored signature image only under AUTO_STAMP, never a placeholder under BLANK', () => {
    const unset = buildWhtCertificateSvg(fields, payerSnapshot, payeeSnapshot).toString('utf8');
    const blank = buildWhtCertificateSvg(fields, payerSnapshot, payeeSnapshot, { mode: 'BLANK' }).toString('utf8');
    const stamped = buildWhtCertificateSvg(fields, payerSnapshot, payeeSnapshot, { mode: 'AUTO_STAMP', signatureImageBase64: 'Zm9v' }).toString('utf8');
    assert.ok(!unset.includes('<image'), 'no signature setting at all draws nothing, matching today');
    assert.ok(!blank.includes('<image'), 'BLANK draws no image at all');
    assert.ok(stamped.includes('<image href="data:image/png;base64,Zm9v"'), 'AUTO_STAMP draws the stored signature');
  });

  it('AUTO_STAMP without an actual image behaves exactly like BLANK, never a broken placeholder', () => {
    const svg = buildWhtCertificateSvg(fields, payerSnapshot, payeeSnapshot, { mode: 'AUTO_STAMP' }).toString('utf8');
    assert.ok(!svg.includes('<image'));
  });

  it('Decision A (2026-09-22): v1 is signature-only — no seal/stamp element exists at all', () => {
    const svg = buildWhtCertificateSvg(fields, payerSnapshot, payeeSnapshot, { mode: 'AUTO_STAMP', signatureImageBase64: 'Zm9v' }).toString('utf8');
    assert.ok(!/seal|ตราประทับ/i.test(svg));
  });
});

describe('renderWhtCertificatePdf', () => {
  it('rasters real Thai ink into a one-page A4 PDF, past the dark-pixel-ratio guard', async () => {
    const svg = buildWhtCertificateSvg(fields, payerSnapshot, payeeSnapshot);
    const bytes = await renderWhtCertificatePdf(svg, fields.certificateNumber);
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(pdf.getTitle(), fields.certificateNumber);
    assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
  });

  it('rejects an implausibly blank certificate the same way substitute receipts do', async () => {
    const blank = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="850" height="180"><rect width="850" height="180" fill="white"/></svg>');
    await assert.rejects(renderWhtCertificatePdf(blank, 'WT-BLANK'), /Thai font missing from the runtime image/);
  });
});
