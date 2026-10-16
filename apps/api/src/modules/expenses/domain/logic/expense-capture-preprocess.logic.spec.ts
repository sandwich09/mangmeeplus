/**
 * Preprocessing against REAL files (appendix §4.2, spec §16.7/§16.8).
 *
 * Every fixture is generated at test time from `pdf-lib` and `sharp` — no binary is committed, and
 * nothing is padded to look big. The properties under test are the ones the contract is explicit
 * about: chunks are decided by MEASURED output bytes (not by dividing the file size), a page too
 * large for a document block becomes an image, a page too large to shrink whole becomes overlapping
 * tiles with an overview, and a page past the declared scope is reported rather than silently cut.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import {
  EXPENSE_CAPTURE_PREPROCESS_LIMITS,
  captureTileRects,
  planCaptureSinglePageChunk,
  planCapturePreprocessing,
  type ExpenseCapturePreprocessLimits,
} from './expense-capture-preprocess.logic';

/** A native-text PDF: header on page 1, rows on every page, a total on the last one. */
async function textPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pages; index += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(index === 0 ? 'SYNTHETIC SHOP / TAX ID 0000000000000' : `CONTINUED PAGE ${index + 1}`,
      { x: 40, y: 800, size: 12, font });
    for (let row = 0; row < 8; row += 1) {
      page.drawText(`ITEM ${index + 1}-${row + 1}   1   ${(row + 1) * 10}.00`, { x: 40, y: 760 - row * 18, size: 10, font });
    }
    if (index === pages - 1) page.drawText('TOTAL 999.00', { x: 40, y: 600, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

/** Random noise compresses badly, so this is a genuinely large scan, not a padded one. */
async function noiseJpeg(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.allocUnsafe(width * height * 3);
  // Deterministic pseudo-noise: a seeded LCG, so a failure is reproducible.
  let seed = 12345;
  for (let index = 0; index < raw.length; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[index] = seed & 0xff;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
}

/** One page whose whole content is a big scanned image and which prints no text at all. */
async function scanPdf(jpeg: Buffer, width: number, height: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  const page = doc.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });
  return Buffer.from(await doc.save());
}

/** pdf-lib writes an xref STREAM, so the encryption marker goes in that dictionary. */
function encrypt(bytes: Buffer): Buffer {
  return Buffer.from(bytes.toString('latin1').replace('/Type /XRef', '/Type /XRef\n/Encrypt 1 0 R'), 'latin1');
}

const plan = (bytes: Buffer, mimeType = 'application/pdf', maxPages = 60, limits?: ExpenseCapturePreprocessLimits) =>
  planCapturePreprocessing(bytes, mimeType, { maxPages, ...(limits ? { limits } : {}) });

describe('capture preprocessing — declared bounds', () => {
  it('states the §4.1 ceilings the whole pipeline is measured against', () => {
    assert.equal(EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxPdfChunkBytes, 4_000_000);
    assert.equal(EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxPdfChunkPages, 1);
    assert.equal(EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImageBytes, 3_500_000);
    assert.equal(EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImageEdgePx, 2_400);
    assert.equal(EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxPdfPages, 20);
    assert.equal(EXPENSE_CAPTURE_PREPROCESS_LIMITS.renderLongEdgePx, 2_400);
    assert.equal(EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxRasterPixels, 32_000_000);
    assert.equal(EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxTextLayerCharsPerPage, 20_000);
  });
});

describe('capture preprocessing — multi-page PDFs', () => {
  const pdfs = new Map<number, Buffer>();

  before(async () => {
    for (const pages of [2, 5, 10, 20, 21]) pdfs.set(pages, await textPdf(pages));
  });

  for (const pages of [2, 5, 10, 20]) {
    it(`covers every page of a ${pages}-page file one page per call`, async () => {
      const result = await plan(pdfs.get(pages)!);
      assert.equal(result.failure, undefined);
      assert.equal(result.pageCount, pages);
      assert.deepEqual(result.pagesBeyondLimit, []);
      const covered = result.chunks.flatMap((chunk) => chunk.pageIndexes);
      assert.deepEqual(covered, Array.from({ length: pages }, (_, index) => index), 'no page is skipped or repeated');
      assert.ok(result.chunks.every((chunk) => chunk.pageIndexes.length === 1), 'exactly one page per call');
      assert.ok(result.chunks.every((chunk) => chunk.byteLength <= EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxPdfChunkBytes),
        'chunk size is MEASURED, not estimated from the page count');
      assert.equal(result.chunks.length, pages);
      for (const chunk of result.chunks) {
        assert.equal((await PDFDocument.load(chunk.bytes!)).getPageCount(), 1);
        assert.match(chunk.bytes!.toString('latin1'), /\/Count\s+1\b/, 'the budget guard can prove this is one page');
      }
      assert.equal(new Set(result.chunks.map((chunk) => chunk.id)).size, result.chunks.length, 'chunk ids are unique');
    });
  }

  it('reads the native text layer of every page in scope, capped per page', async () => {
    const result = await plan(pdfs.get(5)!);
    assert.equal(result.textLayer.length, 5);
    assert.ok(result.textLayer[0]!.text?.includes('SYNTHETIC SHOP'), 'page 1 carries the header');
    assert.ok(result.textLayer[4]!.text?.includes('TOTAL 999.00'), 'the last page carries the total');
    assert.ok(result.textLayer.every((page) => page.chars <= EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxTextLayerCharsPerPage));
  });

  it('reads up to the declared page scope and reports the rest instead of cutting them', async () => {
    const result = await plan(pdfs.get(21)!, 'application/pdf', 20);
    assert.equal(result.pageCount, 21);
    assert.deepEqual(result.pagesBeyondLimit, [20]);
    assert.deepEqual(result.chunks.flatMap((chunk) => chunk.pageIndexes), Array.from({ length: 20 }, (_, index) => index));
    assert.equal(result.textLayer.length, 20, 'no work is done on a page nobody will read');
  });

  it('applies the hard page ceiling even when configured higher', async () => {
    const result = await plan(pdfs.get(21)!, 'application/pdf', 60);
    assert.equal(result.chunks.length, 20);
    assert.deepEqual(result.pagesBeyondLimit, [20]);
  });

  it('re-plans one page on its own for the truncation re-split', async () => {
    const chunk = await planCaptureSinglePageChunk(pdfs.get(5)!, 'application/pdf', 3, 'c2p3');
    assert.ok(chunk);
    assert.equal(chunk!.id, 'c2p3');
    assert.deepEqual(chunk!.pageIndexes, [3]);
    assert.equal(await planCaptureSinglePageChunk(pdfs.get(5)!, 'application/pdf', 99, 'x'), null);
  });
});

describe('capture preprocessing — refusals', () => {
  it('reports an encrypted PDF rather than trying to read it', async () => {
    const result = await plan(encrypt(await textPdf(1)));
    assert.equal(result.failure, 'encrypted_pdf');
    assert.deepEqual(result.chunks, []);
  });

  it('reports a corrupt buffer as corrupt, not as encrypted', async () => {
    const result = await plan(Buffer.from('%PDF-1.7\nthis is not a pdf at all'));
    assert.equal(result.failure, 'corrupt_pdf');
  });

  it('refuses a media type the reader does not handle', async () => {
    const result = await plan(Buffer.from('GIF89a'), 'image/gif');
    assert.equal(result.failure, 'unsupported');
  });
});

describe('capture preprocessing — rasterising', () => {
  it('renders a big scanned page instead of shipping a PDF the reader cannot see', async () => {
    // ~2,200x2,200 of pure noise at q100 is several MB — the worst-case shape of a real phone
    // scan, and deliberately incompressible so the byte bound is genuinely exercised.
    const jpeg = await noiseJpeg(2200, 2200);
    assert.ok(jpeg.byteLength > EXPENSE_CAPTURE_PREPROCESS_LIMITS.scannedPageBytes,
      `fixture must be a genuinely large scan, got ${jpeg.byteLength}`);
    const result = await plan(await scanPdf(jpeg, 595, 842));
    assert.equal(result.failure, undefined);
    assert.equal(result.chunks.length, 1);
    const chunk = result.chunks[0]!;
    assert.notEqual(chunk.kind, 'pdf', 'a scan is read as pixels, not as a document block');
    assert.equal(chunk.mimeType, 'image/jpeg');
    for (const payload of chunk.bytes ? [chunk.bytes] : chunk.images!.map((image) => image.bytes)) {
      assert.ok(payload.byteLength <= EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImageBytes,
        `every image must fit the provider bound, got ${payload.byteLength}`);
    }
    assert.equal(result.textLayer[0]!.chars, 0, 'a scan prints no text layer');
  });

  it('tiles one very large page with an overview and 5 % overlap', async () => {
    // 8,500 points on the long edge: shrinking that whole page to 4,000 px would make printed
    // satang unreadable, so it is read as 2xN regions plus an overview (spec §16.7 point 3).
    const jpeg = await noiseJpeg(1200, 2400);
    const result = await plan(await scanPdf(jpeg, 4_200, 8_500));
    const chunk = result.chunks[0]!;
    assert.equal(chunk.kind, 'tiles');
    assert.ok(chunk.images && chunk.images.length >= 3, 'an overview plus at least one row of tiles');
    assert.equal(chunk.images!.filter((image) => image.role === 'overview').length, 1);
    assert.ok(chunk.images!.length <= EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImagesPerChunk,
      `at most ${EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImagesPerChunk} images per call`);
    for (const image of chunk.images!) {
      assert.ok(image.bytes.byteLength <= EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImageBytes);
      const meta = await sharp(image.bytes).metadata();
      assert.ok((meta.width ?? 0) <= EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImageEdgePx);
      assert.ok((meta.height ?? 0) <= EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImageEdgePx);
    }
    assert.ok(chunk.images!.filter((image) => image.role === 'tile').length >= 2, 'at least one 2-wide row');
  });
});

describe('capture preprocessing — the tile grid', () => {
  it('overlaps every interior seam by 5 %, so no printed row is cut exactly in half', () => {
    const rects = captureTileRects(4_000, 4_000);
    assert.equal(rects.length % 2, 0, 'two columns per row');
    const [topLeft, topRight] = rects;
    assert.equal(topLeft!.left, 0);
    // Column 1 starts BEFORE the midpoint by the overlap, and column 0 ends after it.
    assert.ok(topRight!.left < 2_000, 'the right column starts inside the left one');
    assert.ok(topLeft!.left + topLeft!.width > 2_000, 'the left column ends past the midpoint');
    assert.equal(2_000 - topRight!.left, Math.floor(2_000 * EXPENSE_CAPTURE_PREPROCESS_LIMITS.tileOverlapRatio));
    assert.ok(rects.every((rect) => rect.left >= 0 && rect.top >= 0));
    assert.ok(rects.every((rect) => rect.left + rect.width <= 4_000 && rect.top + rect.height <= 4_000));
  });

  it('never asks for more images than one provider call may carry', () => {
    // A very long receipt: rows grow with the aspect ratio, and the cap is the money bound.
    const rects = captureTileRects(1_000, 40_000);
    assert.ok(rects.length + 1 <= EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImagesPerChunk,
      `overview + tiles must fit ${EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImagesPerChunk}, got ${rects.length + 1}`);
  });
});

describe('capture preprocessing — image attachments', () => {
  /** The edge of the image sharp reports back, so an upscale is measured and not assumed. */
  const edgeOf = async (bytes: Buffer): Promise<number> => {
    const meta = await sharp(bytes).metadata();
    return Math.max(meta.width ?? 0, meta.height ?? 0);
  };

  it('passes a photo that is already legible through untouched', async () => {
    const jpeg = await sharp({ create: { width: 1_600, height: 2_400, channels: 3, background: '#ffffff' } })
      .jpeg({ quality: 80 }).toBuffer();
    const result = await plan(jpeg, 'image/jpeg');
    assert.equal(result.pageCount, 1);
    assert.equal(result.chunks[0]!.kind, 'image');
    assert.equal(result.chunks[0]!.bytes!.byteLength, jpeg.byteLength, 'never re-encode what already fits');
    assert.deepEqual(result.textLayer, []);
  });

  it('re-encodes a photo that is outside the provider image bound', async () => {
    const jpeg = await noiseJpeg(3_000, 3_000);
    assert.ok(jpeg.byteLength > EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImageBytes, `fixture must exceed the bound, got ${jpeg.byteLength}`);
    const result = await plan(jpeg, 'image/jpeg');
    assert.equal(result.chunks[0]!.kind, 'image');
    assert.ok(result.chunks[0]!.byteLength <= EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImageBytes);
    assert.ok(result.chunks[0]!.byteLength < jpeg.byteLength);
  });

  /**
   * W10 D3. The real 896x533 screenshot of a Leceipt invoice (research note §6) came back with its
   * item row and no totals block at all: ~8 px printing, and `truncated: false`. The fix is upstream
   * of the model — give it pixels to read.
   */
  it('never upscales a small screenshot', async () => {
    const jpeg = await sharp({ create: { width: 896, height: 533, channels: 3, background: '#ffffff' } })
      .jpeg({ quality: 85 }).toBuffer();
    const result = await plan(jpeg, 'image/jpeg');
    assert.equal(result.chunks[0]!.kind, 'image');
    assert.equal(result.chunks[0]!.mimeType, 'image/jpeg');
    assert.equal(await edgeOf(result.chunks[0]!.bytes!), 896);
    assert.deepEqual(result.chunks[0]!.bytes, jpeg, 'original input is unchanged');
    assert.ok(result.chunks[0]!.byteLength <= EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImageBytes,
      'and it still fits the provider image bound');
  });

  it('shrinks a large photo to 2400px while preserving its aspect ratio and original bytes', async () => {
    const jpeg = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#f0eedd' } }).jpeg().toBuffer();
    const original = Buffer.from(jpeg);
    const result = await plan(jpeg, 'image/jpeg');
    const meta = await sharp(result.chunks[0]!.bytes!).metadata();
    assert.equal(meta.width, 2400); assert.equal(meta.height, 1800);
    assert.deepEqual(jpeg, original);
  });

  it('never enlarges past the byte ceiling: a dense small scan keeps whatever fits', async () => {
    // Noise at 900 px enlarges to ~1,600 px of noise, which is the worst case for JPEG.
    const jpeg = await noiseJpeg(900, 600);
    const result = await plan(jpeg, 'image/jpeg');
    assert.equal(result.chunks[0]!.kind, 'image');
    assert.ok(result.chunks[0]!.byteLength <= EXPENSE_CAPTURE_PREPROCESS_LIMITS.maxImageBytes);
  });

  it('leaves a large photo alone — only the downscale path may touch it', async () => {
    const jpeg = await sharp({ create: { width: 2_400, height: 1_400, channels: 3, background: '#fbfaf6' } })
      .jpeg({ quality: 85 }).toBuffer();
    const result = await plan(jpeg, 'image/jpeg');
    assert.equal(result.chunks[0]!.byteLength, jpeg.byteLength);
    assert.equal(await edgeOf(result.chunks[0]!.bytes!), 2_400, 'unchanged, not normalised to the floor');
  });
});
