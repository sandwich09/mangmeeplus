// Run against the production-only API graph, never the build stage's dependencies.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const api = createRequire(resolve(process.argv[2], 'package.json'));

async function main() {
  const pdfjsSource = readFileSync(api.resolve('pdfjs-dist/legacy/build/pdf.mjs'), 'utf8');
  assert.equal(pdfjsSource.split('for (let j = srcPos + i * 4, jj = srcPos + len;').length - 1, 2,
    'production PDF.js must include the bounded RGB chunk patch in both endian paths');
  for (const name of Object.keys(api('./package.json').dependencies)) {
    // Prisma's configured generator has a custom output; the default client is not used.
    if (name !== '@prisma/client' && name !== 'pdfjs-dist') api(name);
  }
  assert.equal(typeof api('./dist/apps/api/src/generated/prisma/client.js').PrismaClient, 'function');
  const { PDFDocument, StandardFonts } = api('pdf-lib');
  const sharp = api('sharp');
  const renderer = api('./dist/apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.js');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="850" height="220"><rect width="850" height="220" fill="white"/><text x="425" y="75" text-anchor="middle" font-family="Noto Sans Thai" font-size="32" font-weight="700">ใบรับรองแทนใบเสร็จรับเงิน</text><text x="60" y="140" font-family="Noto Sans Thai" font-size="24">เอกสารทดสอบเพื่อวิเคราะห์ระบบ</text></svg>');
  const digital = await renderer.renderSubstituteReceiptPdf(svg, 'SRC-RUNTIME-CHECK');
  const single = await PDFDocument.load(digital);
  assert.equal(single.getPageCount(), 1);
  const multi = await PDFDocument.create();
  for (let n = 0; n < 3; n++) multi.addPage((await multi.copyPages(single, [0]))[0]);
  const scan = await sharp(svg).jpeg().toBuffer();
  const paper = await renderer.renderSubstituteReceiptPaperArtifactPdf(
    { bytes: scan, mimeType: 'image/jpeg' }, svg, 'SRC-RUNTIME-CHECK',
  );
  for (const [pdf, expected] of [[digital, 1], [Buffer.from(await multi.save()), 3], [paper, 2]]) {
    const pages = await renderer.renderSubstitutePaperPreviewPages(pdf);
    assert.equal(pages.length, expected);
    for (const dataUrl of pages) {
      assert.match(dataUrl, /^data:image\/jpeg;base64,/);
      const image = sharp(Buffer.from(dataUrl.split(',')[1], 'base64'));
      const { width, height } = await image.metadata();
      assert.ok(width > 0 && width <= 1600 && height > 0 && height <= 2400);
      assert.ok((await image.stats()).channels.some(channel => channel.min < 200), 'preview must contain visible ink');
    }
  }
  const { PdfStatementTextExtractor } = api('./dist/apps/api/src/modules/banking/infrastructure/pdf-statement-text.extractor.js');
  // This valid image-only PDF has no text, but it must not be reported as unreadable.
  assert.equal((await new PdfStatementTextExtractor().extractRows(new Uint8Array(digital))).status, 'no_text_layer');
  const statement = await PDFDocument.create();
  const statementPage = statement.addPage([595, 842]);
  const font = await statement.embedFont(StandardFonts.Helvetica);
  const cells = [
    ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
    ['2026-09-14', 'Runtime check', '100.00', '0.00', '900.00'],
  ];
  for (const [row, values] of cells.entries()) {
    for (const [column, value] of values.entries()) {
      statementPage.drawText(value, { x: 30 + column * 110, y: 780 - row * 30, size: 9, font });
    }
  }
  const extracted = await new PdfStatementTextExtractor().extractRows(new Uint8Array(await statement.save()));
  assert.equal(extracted.status, 'ok');
  assert.deepEqual(extracted.rows, [{ postedDate: '2026-09-14', description: 'Runtime check', debit: '100.00', credit: '0.00', balance: '900.00' }]);
  const { normalizeSignatureImage } = api('./dist/apps/api/src/modules/expenses/domain/logic/signature-image.logic.js');
  const signature = await normalizeSignatureImage(scan, 'image/jpeg', { removeBackground: true });
  assert.equal(signature?.mimeType, 'image/png');
  assert.ok((await sharp(signature.bytes).metadata()).hasAlpha);

  // The capture reader (contract appendix §4.2) chunks and RASTERISES inside this image: it needs
  // pdf-lib, pdfjs' native canvas and sharp all working together, which is exactly the combination
  // a production-only dependency graph can lose. A three-page copy plus one rendered page proves it.
  const capture = api('./dist/apps/api/src/modules/expenses/domain/logic/expense-capture-preprocess.logic.js');
  const pages = await PDFDocument.create();
  for (let n = 0; n < 3; n++) pages.addPage((await pages.copyPages(single, [0]))[0]);
  const planned = await capture.planCapturePreprocessing(Buffer.from(await pages.save()), 'application/pdf', { maxPages: 60 });
  assert.equal(planned.failure, undefined);
  assert.equal(planned.pageCount, 3);
  assert.deepEqual(planned.chunks.flatMap(chunk => chunk.pageIndexes), [0, 1, 2]);
  assert.ok(planned.chunks.every(chunk => chunk.byteLength > 0 && chunk.byteLength <= 4_000_000));
  const scanned = await PDFDocument.create();
  const embedded = await scanned.embedJpg(scan);
  scanned.addPage([595, 842]).drawImage(embedded, { x: 0, y: 0, width: 595, height: 842 });
  const rendered = await capture.planCapturePreprocessing(
    Buffer.from(await scanned.save()), 'application/pdf',
    // A one-byte document ceiling forces the raster path, which is the half that needs the canvas.
    { maxPages: 60, limits: { ...capture.EXPENSE_CAPTURE_PREPROCESS_LIMITS, maxPdfChunkBytes: 1 } },
  );
  assert.equal(rendered.chunks.length, 1);
  assert.notEqual(rendered.chunks[0].kind, 'pdf');
  const rasterised = rendered.chunks[0].bytes ?? rendered.chunks[0].images[0].bytes;
  const rasterMeta = await sharp(rasterised).metadata();
  assert.ok(rasterMeta.width > 0 && rasterMeta.height > 0, 'the rendered page must be a real image');
  assert.ok((await sharp(rasterised).stats()).channels.some(channel => channel.min < 200), 'the render must contain ink');

  console.log('[api-runtime] dependencies, Prisma, Thai PDF, 1/3/2-page preview, bank PDF, capture chunk/raster and signature PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
