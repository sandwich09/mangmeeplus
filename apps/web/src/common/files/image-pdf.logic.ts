/**
 * Minimal image-page PDF writer — hand-rolled for the same reason `xlsx.logic.ts` is:
 * one button does not justify a PDF library in the bundle.
 *
 * ponytail: each page carries one fitted image, so text inside the PDF is not
 * selectable. That is the right trade here — the documents we export (ใบเบิกค่าใช้จ่าย,
 * ใบรับรองแทนใบเสร็จ) are rendered server-side as SVG and get printed and signed, never parsed.
 * If a caller ever needs selectable text, that is the point to reach for a real PDF library and
 * re-lay-out the form in PDF primitives — do not grow this file into one.
 */

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const MARGIN_PT = 24;

/** The box a document is drawn into, in PDF points (72 per inch). */
export const A4_USABLE_WIDTH_PT = A4_WIDTH_PT - MARGIN_PT * 2;
export const A4_USABLE_HEIGHT_PT = A4_HEIGHT_PT - MARGIN_PT * 2;

/** PDF binary marker: tells tools the file is not plain text. */
const BINARY_MARKER = Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

const pt = (value: number): string => value.toFixed(2);

export type ImagePdfInput = {
  /** JPEG bytes (DCTDecode) — what `canvas.toDataURL('image/jpeg')` produces. */
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  /**
   * Ceiling on the drawn width. A photo holds a fixed number of pixels: stretched across the page
   * it just gets softer, so callers cap it at the width its own resolution can render sharply.
   */
  maxDrawWidthPt?: number;
};

/** Backwards-compatible single-page entry point. */
export function buildImagePdf(input: ImagePdfInput): Uint8Array {
  return buildImagePagesPdf([input]);
}

/** Ordered A4 pages. Each page retains its own image dimensions and scale. */
export function buildImagePagesPdf(pages: ImagePdfInput[]): Uint8Array {
  if (!pages.length) throw new Error('buildImagePdf: no pages');
  for (const { jpeg, pixelWidth, pixelHeight } of pages) {
    if (jpeg.length === 0) throw new Error('buildImagePdf: empty image');
    if (!(pixelWidth > 0) || !(pixelHeight > 0) || !Number.isFinite(pixelWidth + pixelHeight)) throw new Error('buildImagePdf: image has no size');
  }
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (chunk: string | Uint8Array): void => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    chunks.push(bytes);
    offset += bytes.length;
  };

  // xref needs the byte offset of every object, so objects are written through these helpers.
  const objectOffsets: number[] = [];
  const openObject = (id: number): void => {
    objectOffsets[id - 1] = offset;
    push(`${id} 0 obj\n`);
  };
  const closeObject = (): void => push('endobj\n');

  push('%PDF-1.4\n');
  push(BINARY_MARKER);

  openObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\n');
  closeObject();

  openObject(2);
  push(`<< /Type /Pages /Kids [${pages.map((_page, index) => `${3 + index * 3} 0 R`).join(' ')}] /Count ${pages.length} >>\n`);
  closeObject();

  for (const [index, { jpeg, pixelWidth, pixelHeight, maxDrawWidthPt }] of pages.entries()) {
    const pageId = 3 + index * 3;
    const scale = Math.min(A4_USABLE_WIDTH_PT / pixelWidth, A4_USABLE_HEIGHT_PT / pixelHeight,
      ...(maxDrawWidthPt && maxDrawWidthPt > 0 ? [maxDrawWidthPt / pixelWidth] : []));
    const drawWidth = pixelWidth * scale;
    const drawHeight = pixelHeight * scale;
    const left = (A4_WIDTH_PT - drawWidth) / 2;
    const bottom = (A4_HEIGHT_PT - drawHeight) / 2;
    openObject(pageId);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(A4_WIDTH_PT)} ${pt(A4_HEIGHT_PT)}] `
      + `/Resources << /XObject << /Im0 ${pageId + 1} 0 R >> >> /Contents ${pageId + 2} 0 R >>\n`);
    closeObject();

    openObject(pageId + 1);
    push(`<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push('\nendstream\n');
    closeObject();

    // `cm` maps the image's unit square onto the page rectangle computed above.
    const content = encoder.encode(`q ${pt(drawWidth)} 0 0 ${pt(drawHeight)} ${pt(left)} ${pt(bottom)} cm /Im0 Do Q\n`);
    openObject(pageId + 2);
    push(`<< /Length ${content.length} >>\nstream\n`);
    push(content);
    push('endstream\n');
    closeObject();
  }

  const xrefOffset = offset;
  // Every entry is exactly 20 bytes, including the trailing space before the newline.
  const entries = objectOffsets.map((value) => `${String(value).padStart(10, '0')} 00000 n \n`).join('');
  push(`xref\n0 ${objectOffsets.length + 1}\n0000000000 65535 f \n${entries}`);
  push(`trailer\n<< /Size ${objectOffsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const pdf = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    pdf.set(chunk, cursor);
    cursor += chunk.length;
  }
  return pdf;
}
