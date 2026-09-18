/**
 * Bounded PDF/image preprocessing for the capture reader (appendix §4.2, spec §16.7).
 *
 * The API owns this, not the gateway: the bytes live behind `AttachmentStoragePort` and a
 * permission boundary, and the gateway may only ever see a chunk that already fits the provider's
 * declared limits. Nothing here is written back to storage — every derivative lives in memory for
 * the one provider call that reads it, and the manifest keeps pointing at the ORIGINAL checksum.
 *
 * Reuses the three libraries the API image already ships (`pdf-lib`, `pdfjs-dist` + the
 * `@napi-rs/canvas` it pulls in, `sharp`) and the raster budget the substitute-receipt renderer
 * already proved in production.
 */
import { dirname } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { SUBSTITUTE_RECEIPT_PDF_LIMITS } from './substitute-receipt-pdf.logic';

// Keep the native ESM import intact in the API's CommonJS build, exactly as the bank PDF reader
// and the substitute-receipt renderer do.
const loadPdfjs = (): Promise<any> => Function('return import("pdfjs-dist/legacy/build/pdf.mjs")')();

/**
 * The internal ceilings of appendix §4.1. They are NOT the customer's file limit (10,485,760
 * bytes): they are what one Bedrock Converse call accepts, with margin, measured on the real
 * output bytes rather than estimated from page counts.
 */
export const EXPENSE_CAPTURE_PREPROCESS_LIMITS = Object.freeze({
  /** Bedrock document block is ~4.5 MB; this leaves margin for the prompt and the base64 envelope. */
  maxPdfChunkBytes: 4_000_000,
  maxPdfChunkPages: 3,
  /** Bedrock image block is ~3.75 MB / 8000 px per side. */
  maxImageBytes: 3_500_000,
  maxImageEdgePx: 8_000,
  /** Long edge a whole-page render targets before legibility, not bytes, decides tiling. */
  renderLongEdgePx: 4_000,
  /** Shared with the certificate renderer: the decoded raster of ONE page, never of a document. */
  maxRasterPixels: SUBSTITUTE_RECEIPT_PDF_LIMITS.maxRasterPixels,
  /**
   * Bedrock accepts 20 images in one message, but the DECLARED money bound is tighter and wins:
   * `receipt-capture-read` admits 30,000 input tokens and the gateway prices every image at
   * `AI_BUDGET_IMAGE_TOKEN_CEILING` (2,000), leaving room for ~13 images once the prompt is
   * counted. 12 (an overview + up to 10 tiles) keeps a comfortable margin, so a tile set can
   * never be refused as `input_bound_exceeded` after the page was already rendered.
   */
  maxImagesPerChunk: 12,
  /** Evidence only — the text layer is never sent instead of the page (§4.2 rule 3). */
  maxTextLayerCharsPerPage: 20_000,
  /**
   * Below this whole-page render scale the page is so much larger than 4,000 px that shrinking it
   * whole would make printed Thai and satang unreadable (spec §16.7 point 3), so it is read as
   * 2xN overlapping tiles plus an overview instead.
   */
  tileScaleFloor: 0.5,
  tileOverlapRatio: 0.05,
  /** A page whose own copy is this big and that prints no text is a scan: render it instead. */
  scannedPageBytes: 3_500_000,
  scannedPageTextChars: 20,
} as const);

/** Widened from the frozen table on purpose: a test (and a future per-tenant tune) overrides one. */
export type ExpenseCapturePreprocessLimits = { -readonly [K in keyof typeof EXPENSE_CAPTURE_PREPROCESS_LIMITS]: number };

export type CaptureChunkImage = {
  bytes: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
  role: 'overview' | 'tile';
  index: number;
};

export type CaptureChunkPlan = {
  id: string;
  kind: 'pdf' | 'image' | 'tiles';
  /** Zero-based indexes into the ORIGINAL file, so the manifest and the reader agree on a page. */
  pageIndexes: number[];
  mimeType: string;
  /** Present for `pdf` and `image`; `tiles` carries `images` instead. */
  bytes?: Buffer;
  images?: CaptureChunkImage[];
  /** Measured payload bytes — what the manifest records and the §4.1 bound is checked against. */
  byteLength: number;
};

export type CapturePreprocessFailure = 'encrypted_pdf' | 'corrupt_pdf' | 'unsupported';

export type CapturePreprocessPlan = {
  pageCount: number;
  chunks: CaptureChunkPlan[];
  /** One entry per page inside the declared page scope; `text` is evidence for the span check. */
  textLayer: Array<{ pageIndex: number; chars: number; text?: string }>;
  /** Pages past `maxPages`: read nothing, stay `pending`, and the job PAUSEs with `page_limit`. */
  pagesBeyondLimit: number[];
  failure?: CapturePreprocessFailure;
};

const SUPPORTED_IMAGE_MIME = new Set(['image/jpeg', 'image/png']);

/**
 * Plan (and materialise) every provider call one stored file needs.
 *
 * Page runs are copied with `pdf-lib` and MEASURED — appendix §4.1 is explicit that copying three
 * pages does not promise a third of the file, so a run that overshoots is halved down to a single
 * page before anything is rendered.
 */
export async function planCapturePreprocessing(
  bytes: Buffer,
  mimeType: string,
  options: { maxPages: number; limits?: ExpenseCapturePreprocessLimits },
): Promise<CapturePreprocessPlan> {
  const limits = options.limits ?? EXPENSE_CAPTURE_PREPROCESS_LIMITS;
  const empty = { pageCount: 0, chunks: [], textLayer: [], pagesBeyondLimit: [] };
  if (SUPPORTED_IMAGE_MIME.has(mimeType)) {
    const chunk = await planImageChunk(bytes, mimeType as 'image/jpeg' | 'image/png', limits);
    return chunk
      ? { pageCount: 1, chunks: [chunk], textLayer: [], pagesBeyondLimit: [] }
      : { ...empty, pageCount: 1, failure: 'unsupported' };
  }
  if (mimeType !== 'application/pdf') return { ...empty, failure: 'unsupported' };

  let source: PDFDocument;
  let pageCount: number;
  try {
    source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    // Reading the page tree is part of "can this file be opened": pdf-lib accepts a header-only
    // buffer and only throws when something asks it for a page.
    pageCount = source.getPageCount();
  } catch (error) {
    return { ...empty, failure: isEncryptedPdfError(error) ? 'encrypted_pdf' : 'corrupt_pdf' };
  }
  if (pageCount < 1) return { ...empty, failure: 'corrupt_pdf' };
  const inScope = Math.min(pageCount, Math.max(1, options.maxPages));
  const pagesBeyondLimit = Array.from({ length: pageCount - inScope }, (_, offset) => inScope + offset);

  const textLayer = await readPdfTextLayer(bytes, inScope, limits);
  const textByPage = new Map(textLayer.map((page) => [page.pageIndex, page.chars]));

  const chunks: CaptureChunkPlan[] = [];
  let pageIndex = 0;
  while (pageIndex < inScope) {
    const run = Math.min(limits.maxPdfChunkPages, inScope - pageIndex);
    const group = await fitPdfChunk(source, pageIndex, run, limits);
    if (group.kind === 'pdf') {
      chunks.push({
        id: `c${chunks.length + 1}`, kind: 'pdf', pageIndexes: group.pageIndexes,
        mimeType: 'application/pdf', bytes: group.bytes, byteLength: group.bytes.byteLength,
      });
      pageIndex += group.pageIndexes.length;
      continue;
    }
    // One page that no copy can bring inside the document bound, or a big scan with no text:
    // it is read as an image (or as tiles) instead of as a PDF.
    chunks.push(await renderPageChunk(bytes, pageIndex, `c${chunks.length + 1}`, limits));
    pageIndex += 1;
  }

  // A scanned page inside an otherwise small run: the run fit the byte bound, but the page prints
  // nothing, so re-read that page as an image rather than shipping a PDF the reader cannot see.
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    if (chunk.kind !== 'pdf' || chunk.pageIndexes.length !== 1) continue;
    const page = chunk.pageIndexes[0]!;
    if ((textByPage.get(page) ?? 0) >= limits.scannedPageTextChars) continue;
    if (chunk.byteLength < limits.scannedPageBytes) continue;
    chunks[index] = await renderPageChunk(bytes, page, chunk.id, limits);
  }

  return { pageCount, chunks, textLayer, pagesBeyondLimit };
}

/**
 * Re-plan ONE page on its own (§4.5 re-split): a three-page chunk whose last page came back
 * truncated is retried as that single page rather than as a whole new read of the group.
 */
export async function planCaptureSinglePageChunk(
  bytes: Buffer,
  mimeType: string,
  pageIndex: number,
  chunkId: string,
  limits: ExpenseCapturePreprocessLimits = EXPENSE_CAPTURE_PREPROCESS_LIMITS,
): Promise<CaptureChunkPlan | null> {
  if (mimeType !== 'application/pdf') return null;
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch {
    return null;
  }
  if (pageIndex < 0 || pageIndex >= source.getPageCount()) return null;
  const fitted = await fitPdfChunk(source, pageIndex, 1, limits);
  if (fitted.kind === 'pdf') {
    return {
      id: chunkId, kind: 'pdf', pageIndexes: fitted.pageIndexes, mimeType: 'application/pdf',
      bytes: fitted.bytes, byteLength: fitted.bytes.byteLength,
    };
  }
  return renderPageChunk(bytes, pageIndex, chunkId, limits);
}

/** pdf-lib reports encryption by message; anything else that throws is a broken file. */
function isEncryptedPdfError(error: unknown): boolean {
  return /encrypt/i.test(error instanceof Error ? error.message : String(error));
}

/**
 * Copy `run` consecutive pages, measure, and halve the run until it fits. Returns the pages that
 * fit, or `oversize` for a single page that still does not.
 */
async function fitPdfChunk(
  source: PDFDocument,
  from: number,
  run: number,
  limits: ExpenseCapturePreprocessLimits,
): Promise<{ kind: 'pdf'; pageIndexes: number[]; bytes: Buffer } | { kind: 'oversize' }> {
  for (let size = run; size >= 1; size -= 1) {
    const pageIndexes = Array.from({ length: size }, (_, offset) => from + offset);
    const copy = await PDFDocument.create();
    for (const page of await copy.copyPages(source, pageIndexes)) copy.addPage(page);
    const bytes = Buffer.from(await copy.save());
    if (bytes.byteLength <= limits.maxPdfChunkBytes) return { kind: 'pdf', pageIndexes, bytes };
  }
  return { kind: 'oversize' };
}

/** The page text of appendix §4.2 rule 3: evidence for the span check, never a substitute page. */
async function readPdfTextLayer(
  bytes: Buffer,
  inScope: number,
  limits: ExpenseCapturePreprocessLimits,
): Promise<CapturePreprocessPlan['textLayer']> {
  const out: CapturePreprocessPlan['textLayer'] = [];
  let task: any;
  let document: any;
  try {
    const pdfjs = await loadPdfjs();
    task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true });
    document = await task.promise;
    for (let pageIndex = 0; pageIndex < inScope; pageIndex += 1) {
      let page: any;
      try {
        page = await document.getPage(pageIndex + 1);
        const content = await page.getTextContent();
        const text = content.items
          .map((item: { str?: unknown }) => (typeof item.str === 'string' ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, limits.maxTextLayerCharsPerPage);
        out.push({ pageIndex, chars: text.length, ...(text ? { text } : {}) });
      } catch {
        // A page whose text layer cannot be read is not a failure of the READ — the page still
        // goes to the provider as an image/PDF. It simply contributes no span evidence.
        out.push({ pageIndex, chars: 0 });
      } finally {
        page?.cleanup?.();
      }
    }
  } catch {
    return out;
  } finally {
    await task?.destroy?.().catch?.(() => undefined);
  }
  return out;
}

/** One image attachment: re-encoded ONLY when it is outside the provider's own image bound. */
async function planImageChunk(
  bytes: Buffer,
  mimeType: 'image/jpeg' | 'image/png',
  limits: ExpenseCapturePreprocessLimits,
): Promise<CaptureChunkPlan | null> {
  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(bytes, { limitInputPixels: limits.maxRasterPixels }).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    return null;
  }
  const withinBounds = bytes.byteLength <= limits.maxImageBytes
    && width > 0 && width <= limits.maxImageEdgePx && height > 0 && height <= limits.maxImageEdgePx;
  if (withinBounds) {
    return { id: 'c1', kind: 'image', pageIndexes: [0], mimeType, bytes, byteLength: bytes.byteLength };
  }
  const shrunk = await shrinkToImageBound(bytes, limits);
  return shrunk
    ? { id: 'c1', kind: 'image', pageIndexes: [0], mimeType: 'image/jpeg', bytes: shrunk, byteLength: shrunk.byteLength }
    : null;
}

/** JPEG q85 inside the edge bound, then progressively smaller until the byte bound holds. */
async function shrinkToImageBound(
  bytes: Buffer,
  limits: ExpenseCapturePreprocessLimits,
): Promise<Buffer | null> {
  let edge: number = limits.maxImageEdgePx;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const out = await sharp(bytes, { limitInputPixels: limits.maxRasterPixels })
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      if (out.byteLength <= limits.maxImageBytes) return out;
    } catch {
      return null;
    }
    edge = Math.floor(edge / 2);
  }
  return null;
}

/**
 * Render ONE page, then decide between a single image and 2xN overlapping tiles + an overview.
 *
 * Only one page is decoded at a time and its canvas is destroyed in `finally`, which is the
 * bounded-memory rule of spec §16.7 — the compressed outputs that survive are ≤ 3.5 MB each.
 */
async function renderPageChunk(
  bytes: Buffer,
  pageIndex: number,
  chunkId: string,
  limits: ExpenseCapturePreprocessLimits,
): Promise<CaptureChunkPlan> {
  const pdfjs = await loadPdfjs();
  const resources = dirname(require.resolve('pdfjs-dist/package.json'));
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true,
    standardFontDataUrl: `${resources}/standard_fonts/`, cMapUrl: `${resources}/cmaps/`, cMapPacked: true,
  });
  let document: any;
  let page: any;
  let canvas: any;
  try {
    document = await task.promise;
    page = await document.getPage(pageIndex + 1);
    const base = page.getViewport({ scale: 1 });
    const longEdge = Math.max(base.width, base.height);
    // 0.99 (0.98 of the area) leaves room for the two `Math.ceil`s below: a raster one pixel over
    // the budget is refused by sharp's own `limitInputPixels`, which is the guard, not a warning.
    const pixelBudgetScale = Math.sqrt(limits.maxRasterPixels / Math.max(1, base.width * base.height)) * 0.99;
    const wholePageScale = Math.min(limits.renderLongEdgePx / Math.max(1, longEdge), pixelBudgetScale);
    const tiled = wholePageScale < limits.tileScaleFloor;
    // Tiling reads the page at the pixel budget so the tiles carry MORE detail than the overview;
    // a page that fits whole is rendered only at the size it will actually be sent.
    const scale = tiled ? pixelBudgetScale : wholePageScale;
    const viewport = page.getViewport({ scale });
    canvas = document.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.context, viewport }).promise;
    // JPEG rather than PNG for the intermediate: a 32M-pixel PNG is ~50 MB of process memory for
    // a raster that is about to be re-encoded anyway.
    const raster: Buffer = canvas.canvas.toBuffer('image/jpeg', 92);
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);

    if (!tiled && width <= limits.maxImageEdgePx && height <= limits.maxImageEdgePx) {
      // Quality first, size never: a dense scan that overshoots the byte bound is re-encoded at a
      // lower JPEG quality, which keeps every printed character the same number of pixels tall.
      // Only when even that does not fit is the page split — tiling is for legibility, not bytes.
      for (const quality of [85, 75, 65]) {
        const single = await sharp(raster, { limitInputPixels: limits.maxRasterPixels })
          .jpeg({ quality }).toBuffer();
        if (single.byteLength <= limits.maxImageBytes) {
          return {
            id: chunkId, kind: 'image', pageIndexes: [pageIndex], mimeType: 'image/jpeg',
            bytes: single, byteLength: single.byteLength,
          };
        }
      }
    }
    const images = await tilePage(raster, width, height, limits);
    return {
      id: chunkId, kind: 'tiles', pageIndexes: [pageIndex], mimeType: 'image/jpeg',
      images, byteLength: images.reduce((sum, image) => sum + image.bytes.byteLength, 0),
    };
  } finally {
    if (canvas) document?.canvasFactory?.destroy?.(canvas);
    page?.cleanup?.();
    await task?.destroy?.().catch?.(() => undefined);
  }
}

/**
 * The 2xN grid of §4.2 with 5 % overlap on every interior edge.
 *
 * Pure, so the overlap and the image ceiling are provable without rendering anything: a tile that
 * abutted its neighbour would cut a printed row in half exactly on the seam.
 */
export function captureTileRects(
  width: number,
  height: number,
  limits: ExpenseCapturePreprocessLimits = EXPENSE_CAPTURE_PREPROCESS_LIMITS,
): Array<{ left: number; top: number; width: number; height: number }> {
  const maxTiles = limits.maxImagesPerChunk - 1;
  const columns = 2;
  const rows = Math.max(1, Math.min(Math.ceil((columns * height) / Math.max(1, width)), Math.floor(maxTiles / columns)));
  const overlapX = Math.floor((width / columns) * limits.tileOverlapRatio);
  const overlapY = Math.floor((height / rows) * limits.tileOverlapRatio);
  const rects: Array<{ left: number; top: number; width: number; height: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = Math.max(0, Math.floor((column * width) / columns) - (column > 0 ? overlapX : 0));
      const top = Math.max(0, Math.floor((row * height) / rows) - (row > 0 ? overlapY : 0));
      const right = Math.min(width, Math.ceil(((column + 1) * width) / columns) + (column < columns - 1 ? overlapX : 0));
      const bottom = Math.min(height, Math.ceil(((row + 1) * height) / rows) + (row < rows - 1 ? overlapY : 0));
      if (right - left < 1 || bottom - top < 1) continue;
      rects.push({ left, top, width: right - left, height: bottom - top });
    }
  }
  return rects;
}

/** 2 columns x N rows with 5 % overlap, plus a downscaled overview so layout survives the split. */
async function tilePage(
  raster: Buffer,
  width: number,
  height: number,
  limits: ExpenseCapturePreprocessLimits,
): Promise<CaptureChunkImage[]> {
  const images: CaptureChunkImage[] = [{
    role: 'overview',
    index: 0,
    mimeType: 'image/jpeg',
    bytes: await sharp(raster, { limitInputPixels: limits.maxRasterPixels })
      .resize({ width: limits.renderLongEdgePx, height: limits.renderLongEdgePx, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 }).toBuffer(),
  }];
  for (const rect of captureTileRects(width, height, limits)) {
    images.push({
      role: 'tile',
      index: images.length,
      mimeType: 'image/jpeg',
      bytes: await sharp(raster, { limitInputPixels: limits.maxRasterPixels })
        .extract(rect)
        .resize({ width: limits.maxImageEdgePx, height: limits.maxImageEdgePx, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer(),
    });
  }
  return images;
}
