import sharp from 'sharp';
import { aiDocumentOcrTimeoutMs } from '@watchdog-bms/contracts';
import type { IModelProvider, ProviderInput } from '../../infrastructure/provider/provider.port';

const MAX_DOCUMENT_IMAGE_EDGE_PX = 2400;
const MAX_DOCUMENT_IMAGE_BYTES = 3_500_000;
// Claude vision resizes above 1568 px or 1.15 MP: https://platform.claude.com/docs/en/build-with-claude/vision
const RECEIPT_TILE_MAX_EDGE_PX = 1568;
const RECEIPT_TILE_MAX_PIXELS = 1_150_000;

/** In-memory derivative only. The API stores the original attachment unchanged. */
export async function prepareDocumentImage(image: { mimeType: 'image/jpeg' | 'image/png'; contentBase64: string }) {
  const bytes = Buffer.from(image.contentBase64, 'base64');
  try {
    const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    const width = meta.autoOrient?.width ?? meta.width;
    const height = meta.autoOrient?.height ?? meta.height;
    const timeoutMs = aiDocumentOcrTimeoutMs({ ...image, width, height });
    if (Math.max(width ?? 0, height ?? 0) <= MAX_DOCUMENT_IMAGE_EDGE_PX && bytes.length <= MAX_DOCUMENT_IMAGE_BYTES && !meta.orientation) {
      return { ...image, width, height, timeoutMs };
    }
    for (const edge of [MAX_DOCUMENT_IMAGE_EDGE_PX, 1800, 1200, 600]) {
      const resized = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer();
      if (resized.length <= MAX_DOCUMENT_IMAGE_BYTES) {
        return { mimeType: 'image/jpeg' as const, contentBase64: resized.toString('base64'), width, height, timeoutMs };
      }
    }
  } catch { /* Preserve the provider's typed invalid-image failure for unreadable input. */ }
  return { ...image, timeoutMs: aiDocumentOcrTimeoutMs(image) };
}

/** Tall receipt text retains its width up to the provider edge limit. Adjacent horizontal regions overlap by 10%.
 * These derivatives only feed the read pass, never the stored attachment or extraction facts. */
export async function prepareReceiptReadImages(image: { mimeType: 'image/jpeg' | 'image/png'; contentBase64: string }) {
  let bytes = Buffer.from(image.contentBase64, 'base64');
  let width: number | undefined, height: number | undefined;
  try {
    const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    width = meta.autoOrient?.width ?? meta.width;
    height = meta.autoOrient?.height ?? meta.height;
  } catch { /* The ordinary image path preserves the provider's typed invalid-image failure. */ }
  if (!width || !height || height / width <= 2) return [await prepareDocumentImage(image)];
  if (width > RECEIPT_TILE_MAX_EDGE_PX) {
    const scaled = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
      .resize({ width: RECEIPT_TILE_MAX_EDGE_PX, withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
    bytes = scaled.data;
    width = scaled.info.width;
    height = scaled.info.height;
  }
  const tileHeight = Math.min(RECEIPT_TILE_MAX_EDGE_PX, Math.floor(RECEIPT_TILE_MAX_PIXELS / width));
  const stride = tileHeight - Math.ceil(tileHeight * 0.1);
  const images: Array<{ mimeType: 'image/jpeg'; contentBase64: string }> = [];
  for (let top = 0; top < height; top += stride) {
    const regionHeight = Math.min(tileHeight, height - top);
    const tile = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
      .extract({ left: 0, top, width, height: regionHeight }).jpeg({ quality: 85 }).toBuffer();
    images.push({ mimeType: 'image/jpeg', contentBase64: tile.toString('base64') });
    if (top + regionHeight === height) break;
  }
  return images;
}

export const isLandscapeDocument = (width?: number, height?: number): boolean =>
  Boolean(width && height && width > 1.25 * height);

/** Each attempt uses the normal provider decorator, so both receive their own usage entry. */
export async function readWithTimeoutRetry(provider: IModelProvider, input: ProviderInput) {
  const first = await provider.generateText(input);
  return !first.ok && first.error.code === 'PROVIDER_TIMEOUT'
    ? provider.generateText(input) : first;
}
