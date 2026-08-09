import assert from 'node:assert/strict';
import { SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS } from '@watchdog-bms/contracts';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';
import {
  planSubstituteReceiptRasterSlices,
  renderSubstituteReceiptPdf,
  SUBSTITUTE_RECEIPT_PDF_LIMITS,
} from './substitute-receipt-pdf.logic';
import {
  buildSubstituteCertificationText,
  renderSubstituteReceiptSvg,
  type SubstituteReceiptSnapshot,
} from './substitute-receipt.logic';

const thaiSvg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="850" height="180" viewBox="0 0 850 180">
    <rect width="850" height="180" fill="#fff"/>
    <g font-family="Noto Sans Thai, Tahoma, sans-serif" fill="#111">
      <text x="425" y="70" text-anchor="middle" font-size="25" font-weight="700">ใบรับรองแทนใบเสร็จรับเงิน</text>
      <text x="425" y="120" text-anchor="middle" font-size="18">เลขที่ SRC-EXP-0142-V1 · version 1</text>
    </g>
  </svg>
`);
const requireFromWorkspace = createRequire(join(process.cwd(), 'package.json'));
const standardFontDataUrl = `${dirname(requireFromWorkspace.resolve('pdfjs-dist/package.json'))}/standard_fonts/`;

async function extractPageTexts(bytes: Buffer): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl });
  const document = await task.promise;
  try {
    const texts: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const content = await (await document.getPage(pageNumber)).getTextContent();
      texts.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
    }
    return texts;
  } finally {
    await task.destroy();
  }
}

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

  it('paginates a tall certificate instead of shrinking it onto one unreadable page', async () => {
    const rows = Array.from({ length: 32 }, (_, index) => `
      <text x="70" y="${150 + (index * 70)}" font-size="18">${index + 1}. รายละเอียดค่าใช้จ่ายสำหรับกิจการและหลักฐานประกอบ</text>
      <line x1="50" y1="${170 + (index * 70)}" x2="800" y2="${170 + (index * 70)}" stroke="#bbb"/>
    `).join('');
    const tall = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="850" height="2450" viewBox="0 0 850 2450">
        <rect width="850" height="2450" fill="#fff"/>
        <g font-family="Noto Sans Thai, Tahoma, sans-serif" fill="#111">
          <text x="425" y="70" text-anchor="middle" font-size="25" font-weight="700">ใบรับรองแทนใบเสร็จรับเงิน</text>
          ${rows}
        </g>
      </svg>
    `);
    const bytes = await renderSubstituteReceiptPdf(tall, 'SRC-MULTI-PAGE-V1');
    const pdf = await PDFDocument.load(bytes);
    assert.ok(pdf.getPageCount() >= 2, `Expected multiple pages, got ${pdf.getPageCount()}`);
    assert.equal(pdf.getTitle(), 'SRC-MULTI-PAGE-V1');
    for (const page of pdf.getPages()) assert.deepEqual(page.getSize(), { width: 595.28, height: 841.89 });
    const pageTexts = await extractPageTexts(bytes);
    pageTexts.forEach((text, index) => {
      assert.match(text, /ID: SRC-MULTI-PAGE-V1 \| SHA256: [0-9a-f]{16}/);
      assert.match(text, new RegExp(`Page ${index + 1}/${pageTexts.length}`));
    });
  });

  it('uses semantic renderer hints and preserves contiguous coverage', () => {
    const width = 100;
    const height = 400;
    const channels = 3;
    const white = Buffer.alloc(width * height * channels, 255);
    const slices = planSubstituteReceiptRasterSlices(white, width, height, channels, [140, 280]);
    assert.deepEqual(slices, [
      { top: 0, height: 140 },
      { top: 140, height: 140 },
      { top: 280, height: 120 },
    ]);
    assert.equal(slices.reduce((covered, slice) => covered + slice.height, 0), height);
    slices.slice(1).forEach((slice, index) => {
      assert.equal(slice.top, slices[index]!.top + slices[index]!.height);
    });

    const tooTall = Buffer.alloc(width * 1_000 * channels, 255);
    assert.throws(
      () => planSubstituteReceiptRasterSlices(tooTall, width, 1_000, channels),
      new RegExp(`${SUBSTITUTE_RECEIPT_PDF_LIMITS.maxPages}-page safety limit`),
    );
  });

  it('paginates an actual receipt at renderer-provided block boundaries', async () => {
    const snapshot: SubstituteReceiptSnapshot = {
      documentNumber: 'SRC-INTEGRATION-V1',
      version: 1,
      company: { name: 'บริษัท ทดสอบ จำกัด', branchName: 'สำนักงานใหญ่', taxId: '0100000000000' },
      expense: {
        id: 'expense-integration',
        expenseNumber: 'EXP-1001',
        expenseDate: '2026-08-08T00:00:00.000Z',
        paymentDate: '2026-08-08T00:00:00.000Z',
        currency: 'THB',
        grandTotalAmount: '1800.00',
        paymentMethod: 'CASH',
        paymentReference: null,
        category: 'ทั่วไป',
        businessPurpose: 'จัดซื้อวัสดุสำหรับกิจการ',
        lines: Array.from({ length: 18 }, (_, index) => ({
          description: `รายการที่ ${index + 1} ${'รายละเอียดค่าใช้จ่าย'.repeat(12)}`,
          quantity: '1',
          amount: '100.00',
        })),
      },
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT',
      reasonCode: 'PAYEE_CANNOT_ISSUE',
      missingReceiptReason: 'ผู้ขายรายย่อยไม่สามารถออกใบเสร็จรับเงินได้',
      payee: { name: 'ร้านค้าทดสอบ', address: '1 ถนนทดสอบ กรุงเทพมหานคร', taxId: '1234567890123' },
      payer: { userId: 'payer-1', name: 'ผู้จ่ายเงินจริง', position: 'staff', certifiedAt: '2026-08-08T10:00:00.000Z' },
      certificationText: buildSubstituteCertificationText('ผู้จ่ายเงินจริง', 'staff'),
      evidence: [
        {
          id: 'evidence-1',
          purpose: 'expense.payment.evidence',
          originalFileName: `${'หลักฐานการชำระเงิน'.repeat(12)}.png`,
          mimeType: 'image/png',
          checksumSha256: null,
        },
        {
          id: 'evidence-2',
          purpose: 'expense.receipt.supporting',
          originalFileName: `${'ภาพประกอบรายการ'.repeat(10)}.jpg`,
          mimeType: 'image/jpeg',
          checksumSha256: null,
        },
      ],
      note: null,
    };
    const svg = renderSubstituteReceiptSvg(snapshot);
    const breakAttribute = /data-pdf-breaks="([\d,]+)"/.exec(svg.toString('utf8'))?.[1];
    assert.ok(breakAttribute);
    assert.ok(
      breakAttribute.split(',').length >= snapshot.expense.lines.length + snapshot.evidence.length + 5,
      'Every item and evidence attachment should contribute a semantic page-break boundary.',
    );
    const bytes = await renderSubstituteReceiptPdf(svg, snapshot.documentNumber);
    const pdf = await PDFDocument.load(bytes);
    assert.ok(pdf.getPageCount() >= 2);
    assert.ok(pdf.getPageCount() <= SUBSTITUTE_RECEIPT_PDF_LIMITS.maxPages);
    const pageTexts = await extractPageTexts(bytes);
    pageTexts.forEach((text, index) => {
      assert.match(text, /SRC-INTEGRATION-V1/);
      assert.match(text, new RegExp(`Page ${index + 1}/${pageTexts.length}`));
    });
  });

  it('renders the shared worst-case prepare boundary within the PDF safety ceiling', async () => {
    const thai = (length: number) => 'ก'.repeat(length);
    const limits = SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS;
    const snapshot: SubstituteReceiptSnapshot = {
      documentNumber: 'SRC-BOUNDARY-V1',
      version: 1,
      company: { name: thai(255), branchName: thai(200), taxId: '0100000000000' },
      expense: {
        id: 'expense-boundary',
        expenseNumber: 'EXP-BOUNDARY',
        expenseDate: '2026-08-08T00:00:00.000Z',
        paymentDate: '2026-08-08T00:00:00.000Z',
        currency: 'THB',
        grandTotalAmount: '999999999999.99',
        paymentMethod: 'CASH',
        paymentReference: null,
        category: 'ทั่วไป',
        businessPurpose: thai(500),
        lines: Array.from({ length: limits.maxExpenseLines }, () => ({
          description: thai(limits.maxLineDescriptionLength),
          quantity: '99999999999999.9999',
          amount: '999999999999.99',
        })),
      },
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT',
      reasonCode: 'OTHER',
      missingReceiptReason: thai(500),
      payee: { name: thai(200), address: thai(300), taxId: '1234567890123' },
      payer: { userId: 'payer-1', name: thai(160), position: thai(120), certifiedAt: '2026-08-08T10:00:00.000Z' },
      certificationText: buildSubstituteCertificationText(thai(160), thai(120)),
      evidence: Array.from({ length: limits.maxEvidenceAttachments }, (_, index) => ({
        id: `evidence-${index}`,
        purpose: index % 2 === 0 ? 'expense.payment.evidence' : 'expense.receipt.supporting',
        originalFileName: `${thai(limits.maxEvidenceFileNameLength - 4)}.pdf`,
        mimeType: 'application/pdf',
        checksumSha256: null,
      })),
      note: thai(500),
    };

    const svg = renderSubstituteReceiptSvg(snapshot);
    const bytes = await renderSubstituteReceiptPdf(svg, snapshot.documentNumber);
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), SUBSTITUTE_RECEIPT_PDF_LIMITS.maxPages);
  });

  it('rejects an oversized vector before allocating its production raster', async () => {
    const oversized = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="850" height="20000" viewBox="0 0 850 20000">
        <rect width="850" height="20000" fill="white"/>
        <text x="50" y="100" font-size="20">oversized certificate</text>
      </svg>
    `);
    const startedAt = Date.now();
    await assert.rejects(
      renderSubstituteReceiptPdf(oversized, 'SRC-OVERSIZED-V1'),
      /safe raster size limit/,
    );
    assert.ok(Date.now() - startedAt < 5_000, 'Oversized SVG should fail during metadata probing, before rasterization.');
  });
});
