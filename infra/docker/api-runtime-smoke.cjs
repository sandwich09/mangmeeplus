// Run against the production-only API graph, never the build stage's dependencies.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const api = createRequire(resolve(process.argv[2], 'package.json'));

async function main() {
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
  console.log('[api-runtime] dependencies, Prisma, Thai PDF, 1/3/2-page preview, bank PDF and signature PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
