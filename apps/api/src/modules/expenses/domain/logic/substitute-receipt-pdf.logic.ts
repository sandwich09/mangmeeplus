import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import sharp from 'sharp';
import { withoutSubstituteReceiptPrintMetadata } from './substitute-receipt.logic';
import { cancelledDocumentReasonBox, cancelledDocumentWatermark } from '../../../../common/documents/cancelled-document';

// Keep the native ESM import intact in the API's CommonJS build, as in the bank PDF reader.
const loadPdfjs = (): Promise<any> => Function('return import("pdfjs-dist/legacy/build/pdf.mjs")')();

/** Render the actual composed PDF for browsers without a native PDF viewer. */
export async function renderSubstitutePaperPreviewPages(bytes: Buffer): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const resources = dirname(require.resolve('pdfjs-dist/package.json'));
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false,
    standardFontDataUrl: `${resources}/standard_fonts/`, cMapUrl: `${resources}/cmaps/`, cMapPacked: true });
  try {
    const document = await task.promise;
    // A full generated form may be uploaded after signing; preview includes its attestation and cancellation details.
    if (document.numPages < 1 || document.numPages > SUBSTITUTE_RECEIPT_PDF_LIMITS.maxScanPages + 2 * SUBSTITUTE_RECEIPT_PDF_LIMITS.maxPages) throw new Error('เอกสารมีจำนวนหน้าเกินขอบเขตที่รองรับ');
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1600 / base.width, 2400 / base.height, 2) });
      const canvas = document.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      try {
        await page.render({ canvasContext: canvas.context, viewport }).promise;
        pages.push(`data:image/jpeg;base64,${canvas.canvas.toBuffer('image/jpeg', 90).toString('base64')}`);
      } finally { document.canvasFactory.destroy(canvas); page.cleanup(); }
    }
    return pages;
  } finally { await task.destroy(); }
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 36;
const DENSITY = 200;
/**
 * Floor for the adaptive density below. A certificate long enough to blow the pixel budget at
 * 200 DPI is rasterized coarser rather than refused — but only down to here, so a genuinely
 * absurd vector still trips the raster guard instead of quietly printing unreadably.
 */
const MIN_DENSITY = 150;
const MIN_DARK_PIXEL_RATIO = 0.002;
const CONTENT_WIDTH = A4_WIDTH - (MARGIN * 2);
const CONTENT_HEIGHT = A4_HEIGHT - (MARGIN * 2);

/**
 * A certificate this long is already exceptional for this workflow. Keeping the decoded RGB
 * raster below ~96 MB prevents an authenticated oversized expense from exhausting an API worker.
 * `maxPages` covers 200 wrapped rows plus the existing long notes and evidence filenames.
 * Fixed sheets are rasterized one at a time, retaining the same per-raster memory bounds.
 */
export const SUBSTITUTE_RECEIPT_PDF_LIMITS = Object.freeze({
  maxPages: 64,
  maxScanPages: 64,
  maxRasterPixels: 32_000_000,
  maxRasterDimension: 50_000,
  maxSvgBytes: 8 * 1024 * 1024,
});

export type RasterSlice = { top: number; height: number };
export type SubstituteReceiptPrintStamp = 'VOID' | 'SUPERSEDED' | 'UNSIGNED' | 'AWAITING APPROVAL' | 'AWAITING REVIEW';
type PrintOptions = { stateStamp?: SubstituteReceiptPrintStamp; omitPageFooter?: boolean; cancellationReason?: string | null };
const isCancelled = (stamp: SubstituteReceiptPrintStamp | undefined) => stamp === 'VOID' || stamp === 'SUPERSEDED';

/** Decorate derived copies only. A scan has no trustworthy whitespace, so its reason gets a
 * separate final sheet. Generated pages may use proven whitespace below their last ink row. */
async function addCancellationPresentation(pdf: PDFDocument, reason: string | null | undefined, documentNumber?: string, freeBottom = 0) {
  const box = cancelledDocumentReasonBox(reason, documentNumber);
  const boxHeight = box.height * CONTENT_WIDTH / 760;
  if (freeBottom >= MARGIN + boxHeight + 18) {
    const image = await pdf.embedPng(await sharp(Buffer.from(box.svg), { density: 144 }).png().toBuffer());
    pdf.getPages().at(-1)!.drawImage(image, { x: MARGIN, y: MARGIN, width: CONTENT_WIDTH, height: boxHeight });
  } else {
    const details = await PDFDocument.load(await renderSubstituteReceiptPdf(Buffer.from(box.svg), documentNumber, { omitPageFooter: true }));
    for (const page of await pdf.copyPages(details, details.getPageIndices())) pdf.addPage(page);
  }
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${cancelledDocumentWatermark(width, height)}</svg>`;
    const image = await pdf.embedPng(await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer());
    page.drawImage(image, { x: 0, y: 0, width, height });
  }
}

/**
 * Highest density whose raster still fits the pixel budget, never above DENSITY nor below
 * MIN_DENSITY. `width`/`height` are the SVG's own units (its raster size at 72 DPI), and pixels
 * scale with the square of the density.
 */
export function rasterDensity(width: number, height: number): number {
  const area = width * height;
  if (!(area > 0)) return DENSITY;
  const fitted = Math.floor(72 * Math.sqrt(SUBSTITUTE_RECEIPT_PDF_LIMITS.maxRasterPixels / area));
  return Math.min(DENSITY, Math.max(MIN_DENSITY, fitted));
}

function pixelLuminance(data: Buffer, offset: number, channels: number): number {
  if (channels < 3) return data[offset] ?? 255;
  const red = data[offset] ?? 255;
  const green = data[offset + 1] ?? 255;
  const blue = data[offset + 2] ?? 255;
  return (red * 0.2126) + (green * 0.7152) + (blue * 0.0722);
}

/** Find a low-ink horizontal band near the bottom of the page so wrapped Thai text and table rows
 * are much less likely to be cut in half. Renderer-provided semantic breaks take precedence; this
 * bounded heuristic remains a fallback for legacy artifacts and payment-voucher SVGs. */
function quietBreakRow(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  from: number,
  to: number,
): number {
  let bestRow = to;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = from; y <= to; y += 2) {
    let score = 0;
    const firstBandRow = Math.max(0, y - 3);
    const lastBandRow = Math.min(height - 1, y + 3);
    for (let bandY = firstBandRow; bandY <= lastBandRow; bandY += 1) {
      for (let x = 0; x < width; x += 3) {
        if (pixelLuminance(data, (bandY * width + x) * channels, channels) < 235) score += 1;
      }
    }
    // On equal whitespace, prefer the later break so pages stay full.
    if (score <= bestScore) {
      bestScore = score;
      bestRow = y;
    }
  }
  return bestRow;
}

function assertContiguousCoverage(slices: RasterSlice[], rasterHeight: number): void {
  let expectedTop = 0;
  for (const slice of slices) {
    if (slice.top !== expectedTop || slice.height <= 0) {
      throw new Error('Substitute-receipt pagination produced a non-contiguous raster slice.');
    }
    expectedTop += slice.height;
  }
  if (expectedTop !== rasterHeight) {
    throw new Error('Substitute-receipt pagination did not cover the complete raster.');
  }
}

/** Exported as a pure planner so coverage, semantic-break precedence, and the page ceiling can be
 * regression-tested without allocating a production-sized image. */
export function planSubstituteReceiptRasterSlices(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  preferredBreakRows: number[] = [],
): RasterSlice[] {
  const expectedBytes = width * height * channels;
  if (!Number.isSafeInteger(expectedBytes) || width <= 0 || height <= 0 || channels <= 0 || data.byteLength < expectedBytes) {
    throw new Error('Substitute-receipt raster dimensions are invalid.');
  }
  const maxSliceHeight = Math.max(1, Math.floor(width * (CONTENT_HEIGHT / CONTENT_WIDTH)));
  if (height <= maxSliceHeight) return [{ top: 0, height }];

  const semanticBreaks = [...new Set(preferredBreakRows)]
    .filter((row) => Number.isInteger(row) && row > 0 && row < height)
    .sort((left, right) => left - right);
  const slices: RasterSlice[] = [];
  let top = 0;
  while (height - top > maxSliceHeight) {
    const latestBreak = top + maxSliceHeight;
    const earliestBreak = top + Math.floor(maxSliceHeight * 0.72);
    let semanticBreak: number | undefined;
    for (let index = semanticBreaks.length - 1; index >= 0; index -= 1) {
      const row = semanticBreaks[index]!;
      if (row > latestBreak) continue;
      if (row >= earliestBreak) semanticBreak = row;
      break;
    }
    const nextTop = semanticBreak ?? quietBreakRow(data, width, height, channels, earliestBreak, latestBreak);
    slices.push({ top, height: nextTop - top });
    top = nextTop;
  }
  slices.push({ top, height: height - top });
  assertContiguousCoverage(slices, height);
  if (slices.length > SUBSTITUTE_RECEIPT_PDF_LIMITS.maxPages) {
    throw new Error(`Substitute-receipt PDF exceeds the ${SUBSTITUTE_RECEIPT_PDF_LIMITS.maxPages}-page safety limit.`);
  }
  return slices;
}

function paginationBreakRows(svg: Buffer, rasterHeight: number): number[] {
  const source = svg.toString('utf8');
  const rawBreaks = /\bdata-pdf-breaks=(?:"([^"]*)"|'([^']*)')/.exec(source)?.slice(1).find(Boolean);
  const viewBox = /\bviewBox=(?:"[\s\d.-]+\s([\d.]+)"|'[\s\d.-]+\s([\d.]+)')/.exec(source);
  const viewHeight = Number(viewBox?.[1] ?? viewBox?.[2]);
  if (!rawBreaks || !Number.isFinite(viewHeight) || viewHeight <= 0) return [];
  return rawBreaks.split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0 && value < viewHeight)
    .map((value) => Math.round(value * (rasterHeight / viewHeight)));
}

function assertRasterWithinBounds(svg: Buffer, width: number, height: number): void {
  const pixels = width * height;
  if (
    svg.byteLength > SUBSTITUTE_RECEIPT_PDF_LIMITS.maxSvgBytes
    || !Number.isSafeInteger(pixels)
    || width <= 0
    || height <= 0
    || width > SUBSTITUTE_RECEIPT_PDF_LIMITS.maxRasterDimension
    || height > SUBSTITUTE_RECEIPT_PDF_LIMITS.maxRasterDimension
    || pixels > SUBSTITUTE_RECEIPT_PDF_LIMITS.maxRasterPixels
  ) {
    throw new Error('Substitute-receipt PDF exceeds the safe raster size limit.');
  }
}

function printableDocumentNumber(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/[^\x20-\x7e]/g, '?');
  if (!normalized) return null;
  return normalized.length > 48 ? `${normalized.slice(0, 45)}...` : normalized;
}

/**
 * R11 — the issued artifact of the PAPER route: the scan of the hand-signed sheet first, then the
 * system attestation page. The scan is reproduced as-is; only the attestation is rendered, and it
 * goes through the same rasterizer (and therefore the same Thai-font guard) as every other page.
 *
 * No new dependency: `pdf-lib` already embeds JPEG/PNG and copies pages out of a source PDF, which
 * covers every media type the intake accepts.
 */
export async function renderSubstituteReceiptPaperArtifactPdf(
  scan: { bytes: Buffer; mimeType: string },
  attestationSvg: Buffer | null,
  documentNumber?: string,
  options: PrintOptions = {},
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  await addWetSignedScanPages(pdf, scan);
  // The attestation is rendered UNSTAMPED here and the whole document is stamped below, so the scan
  // pages and the attestation carry one identical mark instead of two sizes of the same word.
  if (attestationSvg) {
    const attestation = await PDFDocument.load(
      await renderSubstituteReceiptPdf(options.omitPageFooter ? withoutSubstituteReceiptPrintMetadata(attestationSvg) : attestationSvg, documentNumber, { omitPageFooter: true }),
    );
    const attestationPages = await pdf.copyPages(attestation, attestation.getPageIndices());
    for (const page of attestationPages) pdf.addPage(page);
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  if (isCancelled(options.stateStamp)) await addCancellationPresentation(pdf, options.cancellationReason, documentNumber);
  const pages = pdf.getPages();
  const safeDocumentNumber = printableDocumentNumber(documentNumber);
  const stamp = options.stateStamp;
  // One size for the whole document: the narrowest page decides, so nothing overflows anywhere.
  const stampSize = stamp
    ? Math.min(96, ...pages.map((page) => (page.getSize().width - MARGIN * 2)
      / (font.widthOfTextAtSize(stamp, 1) || 1)))
    : 0;
  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    if (stamp && !isCancelled(stamp)) {
      page.drawText(stamp, {
        x: (width - font.widthOfTextAtSize(stamp, stampSize)) / 2,
        y: height / 2,
        size: stampSize,
        font,
        color: rgb(0.78, 0.03, 0.03),
        opacity: 0.32,
      });
    }
    if (options.omitPageFooter) return;
    // R11 identity: every page of a composed artifact says which document it belongs to and where
    // it sits, so a scan page separated from the attestation is still traceable — and the
    // attestation's own "Page 1/1" is corrected to its real position in the composed file.
    const label = `Page ${index + 1}/${pages.length}`;
    const identity = safeDocumentNumber ? `ID: ${safeDocumentNumber}` : 'ID: -';
    page.drawText(identity, { x: MARGIN, y: 7, size: 7.5, font, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(label, {
      x: width - MARGIN - font.widthOfTextAtSize(label, 7.5), y: 7, size: 7.5, font, color: rgb(0.35, 0.35, 0.35),
    });
  });
  pdf.setTitle(safeDocumentNumber ?? 'substitute-receipt');
  pdf.setSubject(`Wet-signed scan${attestationSvg ? ' + system attestation' : ''}${stamp ? ` | State: ${stamp}` : ''}`);
  return Buffer.from(await pdf.save());
}

/** Reproduces the scan into `pdf` and returns the pages it added. Every failure mode a stored scan
 *  can have — undecodable bytes, an encrypted PDF, an unsupported type, more pages than the artifact
 *  may hold — surfaces HERE, which is why `substituteWetSignedScanRejection` runs this same path at
 *  link time: an artifact that cannot be composed must be refused before it is ever issued. */
async function addWetSignedScanPages(pdf: PDFDocument, scan: { bytes: Buffer; mimeType: string }): Promise<PDFPage[]> {
  if (scan.mimeType === 'application/pdf') {
    const source = await PDFDocument.load(scan.bytes);
    // +1 for the attestation page the composed artifact always ends with.
    if (source.getPageCount() < 1 || source.getPageCount() > SUBSTITUTE_RECEIPT_PDF_LIMITS.maxScanPages) {
      throw new Error(`Substitute-receipt PDF exceeds the ${SUBSTITUTE_RECEIPT_PDF_LIMITS.maxScanPages + 1}-page safety limit.`);
    }
    return (await pdf.copyPages(source, source.getPageIndices())).map((page) => pdf.addPage(page));
  }
  if (scan.mimeType !== 'image/jpeg' && scan.mimeType !== 'image/png') {
    throw new Error('A wet-signed scan must be a JPEG, PNG, or PDF.');
  }
  const metadata = await sharp(scan.bytes, { limitInputPixels: SUBSTITUTE_RECEIPT_PDF_LIMITS.maxRasterPixels }).metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > SUBSTITUTE_RECEIPT_PDF_LIMITS.maxRasterPixels) {
    throw new Error('Wet-signed scan image exceeds the supported pixel limit.');
  }
  const image = scan.mimeType === 'image/jpeg' ? await pdf.embedJpg(scan.bytes) : await pdf.embedPng(scan.bytes);
  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  const scale = Math.min(CONTENT_WIDTH / image.width, CONTENT_HEIGHT / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, { x: (A4_WIDTH - width) / 2, y: A4_HEIGHT - MARGIN - height, width, height });
  return [page];
}

/**
 * R11 gate, run BEFORE a scan is linked: returns a human reason when these bytes could never be
 * composed into the issued artifact, or `undefined` when they can. Linking an uncomposable scan is
 * the worst available outcome — it certifies and issues cleanly, and then every download of the
 * finished legal document fails with no way back.
 */
export async function substituteWetSignedScanRejection(scan: { bytes: Buffer; mimeType: string }): Promise<string | undefined> {
  try {
    await addWetSignedScanPages(await PDFDocument.create(), scan);
    return undefined;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return /safety limit|must be a JPEG/.test(reason)
      ? reason
      : `The scanned form cannot be read as a printable document (${reason.slice(0, 120)}).`;
  }
}

/** Render fixed sheets independently, preserving the raster memory bound as documents grow. */
function substituteReceiptSourcePages(svg: Buffer): Buffer[] {
  const source = svg.toString('utf8');
  const root = /<svg\b[^>]*>/.exec(source)?.[0];
  const pageHeight = Number(root?.match(/data-pdf-page-height="(\d+)"/)?.[1]);
  if (!pageHeight || !root) return [svg];
  const height = Number(root.match(/\bheight="(\d+)"/)?.[1]);
  const count = height / pageHeight;
  if (!Number.isSafeInteger(count) || count < 1 || count > SUBSTITUTE_RECEIPT_PDF_LIMITS.maxPages) {
    throw new Error(`Substitute-receipt PDF exceeds the ${SUBSTITUTE_RECEIPT_PDF_LIMITS.maxPages}-page safety limit.`);
  }
  const sheets = [...source.matchAll(/<svg\b[^>]* data-pdf-sheet="\d+"[^>]*>[\s\S]*?<\/svg>/g)];
  if (sheets.length === count) return sheets.map(match => Buffer.from(match[0].replace(/ y="\d+"/, ''), 'utf8'));
  return Array.from({ length: count }, (_, index) => Buffer.from(source.replace(root,
    root.replace(/\bheight="\d+"/, `height="${pageHeight}"`)
      .replace(/viewBox="[^"]*"/, `viewBox="0 ${index * pageHeight} 850 ${pageHeight}"`)
      .replace(/ data-pdf-(?:page-height|breaks)="[^"]*"/g, ''))
    .replace('height="100%"', `height="${height}"`), 'utf8'));
}

async function rasterizeSubstituteReceipt(svg: Buffer) {
  // Probe the vector's own size first (72 DPI = its SVG units) so the production density can be
  // fitted to the pixel budget instead of allocating past it and throwing.
  const printSvg = withoutSubstituteReceiptPrintMetadata(svg);
  const intrinsic = await sharp(printSvg, { density: 72, limitInputPixels: false }).metadata();
  const raster = sharp(printSvg, {
    density: rasterDensity(intrinsic.width ?? 0, intrinsic.height ?? 0),
    limitInputPixels: false,
  });
  const metadata = await raster.metadata();
  const metadataWidth = metadata.width ?? 0;
  const metadataHeight = metadata.height ?? 0;
  assertRasterWithinBounds(svg, metadataWidth, metadataHeight);

  // Decode once into RGB. Each page is encoded directly from a contiguous raw-buffer view, avoiding
  // the old O(page count) full-PNG decode and preserving colour signatures.
  const { data, info } = await raster.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assertRasterWithinBounds(svg, info.width, info.height);
  let darkPixels = 0;
  for (let offset = 0; offset < data.byteLength; offset += info.channels) {
    if (pixelLuminance(data, offset, info.channels) < 200) darkPixels += 1;
  }
  if (darkPixels / (info.width * info.height) < MIN_DARK_PIXEL_RATIO) {
    throw new Error('Thai font missing from the runtime image; the rendered certificate is blank.');
  }

  const slices = planSubstituteReceiptRasterSlices(
    data,
    info.width,
    info.height,
    info.channels,
    paginationBreakRows(svg, info.height),
  );
  return { data, info, slices };
}

/** `documentNumber` is passed in rather than parsed back out of the SVG: the caller already holds the
 * evidence row, and scraping rendered text would break silently the next time the layout changes. */
export async function renderSubstituteReceiptPdf(
  svg: Buffer,
  documentNumber?: string,
  options: PrintOptions = {},
): Promise<Buffer> {
  if (svg.byteLength > SUBSTITUTE_RECEIPT_PDF_LIMITS.maxSvgBytes) {
    throw new Error('Substitute-receipt PDF exceeds the safe raster size limit.');
  }
  const pdf = await PDFDocument.create();
  const stampFont = await pdf.embedFont(StandardFonts.Helvetica);
  const sourceDigest = createHash('sha256').update(svg).digest('hex');
  const safeDocumentNumber = printableDocumentNumber(documentNumber);
  const identity = safeDocumentNumber
    ? `ID: ${safeDocumentNumber} | SHA256: ${sourceDigest.slice(0, 16)}`
    : `SHA256: ${sourceDigest.slice(0, 32)}`;
  const stampSize = 7.5;
  let freeBottom = 0;

  const sourcePages = substituteReceiptSourcePages(svg);
  const continuation = sourcePages.length > 1;
  for (const sourcePage of sourcePages) {
    const { data, info, slices } = await rasterizeSubstituteReceipt(sourcePage);
    for (const [index, slice] of slices.entries()) {
    const rowBytes = info.width * info.channels;
    const slicePixels = data.subarray(slice.top * rowBytes, (slice.top + slice.height) * rowBytes);
    const encoder = sharp(slicePixels, {
      raw: { width: info.width, height: slice.height, channels: info.channels },
    });
    // Native JPEG encoding avoids retaining/deflating hundreds of megapixels in JavaScript.
    // Single-sheet copies keep their original lossless bytes.
    const sliceImage = await (continuation ? encoder.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }) : encoder.png()).toBuffer();
    const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    const image = await (continuation ? pdf.embedJpg(sliceImage) : pdf.embedPng(sliceImage));
    // Encode now so pdf-lib releases this sheet's decoded pixels before the next sheet.
    await image.embed();
    const scale = Math.min(CONTENT_WIDTH / image.width, CONTENT_HEIGHT / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      x: (A4_WIDTH - width) / 2,
      y: A4_HEIGHT - MARGIN - height,
      width,
      height,
    });
    if (isCancelled(options.stateStamp) && index === slices.length - 1) {
      let lastInkRow = slice.height - 1;
      scan: for (; lastInkRow >= 0; lastInkRow -= 1) {
        for (let x = 0; x < info.width; x += 1) {
          if (pixelLuminance(slicePixels, (lastInkRow * info.width + x) * info.channels, info.channels) < 245) break scan;
        }
      }
      freeBottom = A4_HEIGHT - MARGIN - (lastInkRow + 1) * scale;
    }
    if (options.stateStamp && !isCancelled(options.stateStamp)) {
      const stateSize = Math.min(54, CONTENT_WIDTH / stampFont.widthOfTextAtSize(options.stateStamp, 1));
      const stateWidth = stampFont.widthOfTextAtSize(options.stateStamp, stateSize);
      page.drawText(options.stateStamp, {
        x: (A4_WIDTH - stateWidth) / 2,
        y: A4_HEIGHT / 2,
        size: stateSize,
        font: stampFont,
        color: rgb(0.78, 0.03, 0.03),
        opacity: 0.32,
      });
    }
  }
  }
  if (isCancelled(options.stateStamp)) await addCancellationPresentation(pdf, options.cancellationReason, documentNumber, freeBottom);
  // Count any appended cancellation detail pages before writing optional legacy footers.
  for (const [index, page] of pdf.getPages().entries()) {
    if (options.omitPageFooter) break;
    const pageLabel = `Page ${index + 1}/${pdf.getPageCount()}`;
    page.drawText(identity, { x: MARGIN, y: 17, size: stampSize, font: stampFont, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(pageLabel, {
      x: A4_WIDTH - MARGIN - stampFont.widthOfTextAtSize(pageLabel, stampSize),
      y: 17,
      size: stampSize,
      font: stampFont,
      color: rgb(0.35, 0.35, 0.35),
    });
  }
  pdf.setTitle(safeDocumentNumber ?? `SHA256-${sourceDigest.slice(0, 16)}`);
  pdf.setSubject(`Source SHA256: ${sourceDigest}${options.stateStamp ? ` | State: ${options.stateStamp}` : ''}`);
  return Buffer.from(await pdf.save());
}
