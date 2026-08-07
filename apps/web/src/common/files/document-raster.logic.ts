import { A4_USABLE_HEIGHT_PT, A4_USABLE_WIDTH_PT } from './image-pdf.logic';

/** Aim for laser-print quality on the page. */
const TARGET_DPI = 300;
/**
 * How far a fixed-pixel source may be stretched. Past this a photo is not "bigger", just softer —
 * below it the page looks blurry, which is exactly the complaint a full-bleed 470px receipt draws.
 */
const MIN_RASTER_DPI = 150;
/** iOS Safari refuses canvases over ~16.7M pixels and 4096 per edge; both silently produce a blank. */
const MAX_CANVAS_PIXELS = 12_000_000;
const MAX_CANVAS_EDGE = 4096;

export type RasterPlan = {
  /** Multiply the source's CSS pixel size by this to get the canvas size. */
  rasterScale: number;
  canvasWidth: number;
  canvasHeight: number;
  /** Passed to `buildImagePdf` so a low-resolution source is drawn small and sharp, not stretched. */
  maxDrawWidthPt: number;
  /** What the page will actually resolve to, for logging/tests. */
  effectiveDpi: number;
};

/**
 * Decides how large to rasterise a document before it becomes a PDF page.
 *
 * `vector` sources (our SVG forms) carry no fixed resolution, so they are rendered straight at the
 * target DPI and always fill the page. Raster sources (receipt photos, screenshots) are capped both
 * ways: never enlarged past what their own pixels support, never rasterised past what a phone
 * browser can allocate.
 */
export function planDocumentRaster(input: { naturalWidth: number; naturalHeight: number; vector: boolean }): RasterPlan {
  const width = Math.max(1, input.naturalWidth);
  const height = Math.max(1, input.naturalHeight);

  const fitScale = Math.min(A4_USABLE_WIDTH_PT / width, A4_USABLE_HEIGHT_PT / height);
  const maxDrawWidthPt = input.vector
    ? width * fitScale
    : Math.min(width * fitScale, (width / MIN_RASTER_DPI) * 72);

  const targetPixels = (maxDrawWidthPt / 72) * TARGET_DPI;
  const rasterScale = Math.min(
    Math.max(1, targetPixels / width),
    MAX_CANVAS_EDGE / Math.max(width, height),
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
  );

  const canvasWidth = Math.max(1, Math.round(width * rasterScale));
  const canvasHeight = Math.max(1, Math.round(height * rasterScale));
  return {
    rasterScale,
    canvasWidth,
    canvasHeight,
    maxDrawWidthPt,
    effectiveDpi: Math.round(canvasWidth / (maxDrawWidthPt / 72)),
  };
}
