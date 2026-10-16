import sharp from 'sharp';
import { aiDocumentOcrTimeoutMs } from '@watchdog-bms/contracts';
import type { IModelProvider, ProviderInput } from '../../infrastructure/provider/provider.port';

/** In-memory derivative only. The API stores the original attachment unchanged. */
export async function prepareDocumentImage(image: { mimeType: 'image/jpeg' | 'image/png'; contentBase64: string }) {
  const bytes = Buffer.from(image.contentBase64, 'base64');
  try {
    const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    const width = meta.autoOrient?.width ?? meta.width;
    const height = meta.autoOrient?.height ?? meta.height;
    const timeoutMs = aiDocumentOcrTimeoutMs({ ...image, width, height });
    if (Math.max(width ?? 0, height ?? 0) <= 2400 && bytes.length <= 3_500_000 && !meta.orientation) {
      return { ...image, width, height, timeoutMs };
    }
    for (const edge of [2400, 1800, 1200, 600]) {
      const resized = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer();
      if (resized.length <= 3_500_000) {
        return { mimeType: 'image/jpeg' as const, contentBase64: resized.toString('base64'), width, height, timeoutMs };
      }
    }
  } catch { /* Preserve the provider's typed invalid-image failure for unreadable input. */ }
  return { ...image, timeoutMs: aiDocumentOcrTimeoutMs(image) };
}

export const isLandscapeDocument = (width?: number, height?: number): boolean =>
  Boolean(width && height && width > 1.25 * height);

/** Each attempt uses the normal provider decorator, so both receive their own usage entry. */
export async function readWithTimeoutRetry(provider: IModelProvider, input: ProviderInput) {
  const first = await provider.generateText(input);
  return !first.ok && first.error.code === 'PROVIDER_TIMEOUT'
    ? provider.generateText(input) : first;
}
