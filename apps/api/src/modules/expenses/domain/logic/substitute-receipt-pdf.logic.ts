import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 36;
const DENSITY = 200;
const MIN_DARK_PIXEL_RATIO = 0.002;

/** `documentNumber` is passed in rather than parsed back out of the SVG: the caller already holds the
 *  evidence row, and scraping the rendered text would break silently the next time the layout changes. */
export async function renderSubstituteReceiptPdf(svg: Buffer, documentNumber?: string): Promise<Buffer> {
  const png = await sharp(svg, { density: DENSITY }).png().toBuffer();
  const { data, info } = await sharp(png).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  let darkPixels = 0;
  for (const pixel of data) if (pixel < 200) darkPixels += 1;
  if (darkPixels / (info.width * info.height) < MIN_DARK_PIXEL_RATIO) {
    throw new Error('Thai font missing from the runtime image; the rendered certificate is blank.');
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  const image = await pdf.embedPng(png);
  const scale = Math.min(
    (A4_WIDTH - (MARGIN * 2)) / image.width,
    (A4_HEIGHT - (MARGIN * 2)) / image.height,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: (A4_WIDTH - width) / 2,
    y: (A4_HEIGHT - height) / 2,
    width,
    height,
  });
  if (documentNumber) pdf.setTitle(documentNumber);
  return Buffer.from(await pdf.save());
}
