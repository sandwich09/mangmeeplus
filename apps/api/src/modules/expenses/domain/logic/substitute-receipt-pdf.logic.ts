import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';

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
 * `maxPages` leaves a page of slack above the worst input the renderability limits allow (5 pages)
 * — it used to be exactly that worst case, so any change to the layout broke the promise that
 * anything inside those limits renders at all.
 */
export const SUBSTITUTE_RECEIPT_PDF_LIMITS = Object.freeze({
  maxPages: 6,
  maxRasterPixels: 32_000_000,
  maxRasterDimension: 50_000,
  maxSvgBytes: 8 * 1024 * 1024,
});

export type RasterSlice = { top: number; height: number };

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

/** `documentNumber` is passed in rather than parsed back out of the SVG: the caller already holds the
 * evidence row, and scraping rendered text would break silently the next time the layout changes. */
export async function renderSubstituteReceiptPdf(
  svg: Buffer,
  documentNumber?: string,
  options: { stateStamp?: 'VOID' | 'SUPERSEDED' | 'UNSIGNED' } = {},
): Promise<Buffer> {
  if (svg.byteLength > SUBSTITUTE_RECEIPT_PDF_LIMITS.maxSvgBytes) {
    throw new Error('Substitute-receipt PDF exceeds the safe raster size limit.');
  }
  // Probe the vector's own size first (72 DPI = its SVG units) so the production density can be
  // fitted to the pixel budget instead of allocating past it and throwing.
  const intrinsic = await sharp(svg, { density: 72, limitInputPixels: false }).metadata();
  const raster = sharp(svg, {
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
  const pdf = await PDFDocument.create();
  const stampFont = await pdf.embedFont(StandardFonts.Helvetica);
  const sourceDigest = createHash('sha256').update(svg).digest('hex');
  const safeDocumentNumber = printableDocumentNumber(documentNumber);
  const identity = safeDocumentNumber
    ? `ID: ${safeDocumentNumber} | SHA256: ${sourceDigest.slice(0, 16)}`
    : `SHA256: ${sourceDigest.slice(0, 32)}`;
  const stampSize = 7.5;

  for (const [index, slice] of slices.entries()) {
    const rowBytes = info.width * info.channels;
    const slicePixels = data.subarray(slice.top * rowBytes, (slice.top + slice.height) * rowBytes);
    const slicePng = await sharp(slicePixels, {
      raw: { width: info.width, height: slice.height, channels: info.channels },
    }).png().toBuffer();
    const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    const image = await pdf.embedPng(slicePng);
    const scale = Math.min(CONTENT_WIDTH / image.width, CONTENT_HEIGHT / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      x: (A4_WIDTH - width) / 2,
      y: A4_HEIGHT - MARGIN - height,
      width,
      height,
    });
    if (options.stateStamp) {
      const stateSize = options.stateStamp === 'VOID' ? 96 : 54;
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
    const pageLabel = `Page ${index + 1}/${slices.length}`;
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
