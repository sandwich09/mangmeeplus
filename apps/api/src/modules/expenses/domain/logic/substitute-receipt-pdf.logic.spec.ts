import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { renderSubstituteReceiptPdf } from './substitute-receipt-pdf.logic';

const thaiSvg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="850" height="180" viewBox="0 0 850 180">
    <rect width="850" height="180" fill="#fff"/>
    <g font-family="Noto Sans Thai, Tahoma, sans-serif" fill="#111">
      <text x="425" y="70" text-anchor="middle" font-size="25" font-weight="700">ใบรับรองแทนใบเสร็จรับเงิน</text>
      <text x="425" y="120" text-anchor="middle" font-size="18">เลขที่ SRC-EXP-0142-V1 · version 1</text>
    </g>
  </svg>
`);

describe('substitute receipt PDF', () => {
  it('renders Thai ink into a one-page A4 PDF', async () => {
    const { data, info } = await sharp(thaiSvg, { density: 200 }).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
    const inkRatio = data.reduce((count, pixel) => count + (pixel < 200 ? 1 : 0), 0) / (info.width * info.height);
    assert.ok(inkRatio >= 0.002, `Thai font ink ratio ${inkRatio} is below 0.2%`);

    const bytes = await renderSubstituteReceiptPdf(thaiSvg, 'SRC-EXP-0142-V1');
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(pdf.getTitle(), 'SRC-EXP-0142-V1');
    assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
    assert.ok(bytes.byteLength < 2_000_000, `Rendered PDF is ${bytes.byteLength} bytes`);
    console.log(`Rendered PDF: ${bytes.byteLength} bytes; Thai ink ratio: ${(inkRatio * 100).toFixed(3)}%`);
  });

  it('rejects an implausibly blank certificate', async () => {
    const blank = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="850" height="180"><rect width="850" height="180" fill="white"/></svg>');
    await assert.rejects(
      renderSubstituteReceiptPdf(blank),
      /Thai font missing from the runtime image; the rendered certificate is blank\./,
    );
  });
});
