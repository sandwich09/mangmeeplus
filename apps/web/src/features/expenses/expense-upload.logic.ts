import { attachmentMimeTypeForFileName } from '@/common/files/upload-file.logic';

// The budget a re-encoded photo is compressed into. Every server-side limit on this path is
// 10 MB — `UPLOAD_MAX_BYTES` (packages/config), the attachment gate, and `MAX_EXTRACTION_BYTES`
// in expense-extraction.use-case.ts — so the old 2 MB was a client-only ceiling five times
// tighter than anything that required it, and a phone photo is the only input that ever meets
// it (a PDF returns early, uncompressed, which is why desktop scans were never affected).
// A receipt's เลขประจำตัวผู้เสียภาษี is its smallest print, so it is the first thing lost when
// this budget forces the quality floor — and the OCR grounding check then drops an unverifiable
// tax id rather than guessing, which is why it came back empty instead of wrong.
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_PDF_EXTRACTION_BYTES = 4 * 1024 * 1024;
// Long edge of a re-encoded photo, and the floor the JPEG quality ladder stops at. Both are set
// for reading 13 small digits, not for looking at a picture: below ~0.7 the artefacts close the
// counters of 6/8/9 and merge adjacent digits.
const MAX_IMAGE_EDGE_PX = 3200;
const MIN_IMAGE_QUALITY = 0.72;
export const RECEIPT_UPLOAD_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.heic,.heif,application/pdf,image/png,image/jpeg,image/heic,image/heif';

export type UploadFileKind = 'image' | 'pdf' | 'heic' | 'unsupported';

export class HeicDecodeError extends Error {
  constructor() {
    super('HEIC_DECODE_UNSUPPORTED');
    this.name = 'HeicDecodeError';
  }
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

export function detectReceiptImageByteKind(bytes: Uint8Array): 'jpeg' | 'png' | 'heic' | 'unknown' {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return 'jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return 'png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp') {
    const boxSize = Math.min(bytes.length, ((bytes[0] ?? 0) * 0x1000000) + ((bytes[1] ?? 0) * 0x10000) + ((bytes[2] ?? 0) * 0x100) + (bytes[3] ?? 0));
    for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
      if (offset !== 12 && HEIF_BRANDS.has(String.fromCharCode(...bytes.subarray(offset, offset + 4)))) return 'heic';
    }
  }
  return 'unknown';
}

export function classifyUploadFile(name: string, type: string): UploadFileKind {
  const mime = type.toLowerCase();
  const extension = name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (!mime) {
    if (extension === 'pdf') return 'pdf';
    if (extension === 'heic' || extension === 'heif') return 'heic';
    if (['jpg', 'jpeg', 'png'].includes(extension ?? '')) return 'image';
    return 'unsupported';
  }
  if (mime === 'application/pdf' && extension === 'pdf') return 'pdf';
  if ((mime === 'image/heic' && extension === 'heic') || (mime === 'image/heif' && extension === 'heif')) return 'heic';
  if (
    (mime === 'image/jpeg' && (extension === 'jpg' || extension === 'jpeg'))
    || (mime === 'image/png' && extension === 'png')
  ) return 'image';
  return 'unsupported';
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const canvasBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('IMAGE_ENCODE_FAILED')), 'image/jpeg', quality));

// Chrome/Edge cannot decode HEIC natively — heic-to (libheif wasm) is lazy-loaded
// only when a HEIC file actually fails native decode, so it never weighs the page.
async function heicToJpegFile(file: File): Promise<File> {
  const { heicTo } = await import('heic-to/csp');
  const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
  if (!blob) throw new HeicDecodeError();
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'receipt';
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
}

export async function prepareReceiptFile(file: File): Promise<{ file: File; resized: boolean }> {
  const kind = classifyUploadFile(file.name, file.type);
  if (kind === 'unsupported') throw new Error('UNSUPPORTED_UPLOAD_FILE');
  const inferredMimeType = attachmentMimeTypeForFileName(file.name)
    ?? (file.name.toLowerCase().endsWith('.heic') ? 'image/heic' : 'image/heif');
  const sourceFile = file.type
    ? file
    : new File([file], file.name, { type: inferredMimeType, lastModified: file.lastModified });
  // LINE Desktop can save HEIC bytes behind .jpg/image/jpeg metadata. Only preserve an image
  // byte-for-byte when its container agrees; mismatches are decoded into a real JPEG below.
  const byteKind = kind === 'image' || kind === 'heic'
    ? detectReceiptImageByteKind(new Uint8Array(await sourceFile.arrayBuffer()))
    : 'unknown';
  const bytesMatchDeclaredType = (sourceFile.type === 'image/jpeg' && byteKind === 'jpeg')
    || (sourceFile.type === 'image/png' && byteKind === 'png');
  if (kind === 'pdf' || (kind === 'image' && sourceFile.size <= MAX_IMAGE_BYTES && bytesMatchDeclaredType)) {
    return { file: sourceFile, resized: false };
  }

  let image: ImageBitmap | HTMLImageElement;
  try { image = await decodeImage(sourceFile); }
  catch (error) {
    if (kind !== 'heic' && byteKind !== 'heic') throw error;
    let converted: File;
    const heicFile = kind === 'heic'
      ? sourceFile
      : new File([sourceFile], sourceFile.name.replace(/\.[^.]+$/, '.heic'), { type: 'image/heic', lastModified: sourceFile.lastModified });
    try { converted = await heicToJpegFile(heicFile); }
    catch { throw new HeicDecodeError(); }
    if (converted.size <= MAX_IMAGE_BYTES) return { file: converted, resized: true };
    image = await decodeImage(converted);
  }

  const sourceWidth = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const sourceHeight = 'naturalHeight' in image ? image.naturalHeight : image.height;
  const initialScale = Math.min(1, MAX_IMAGE_EDGE_PX / Math.max(sourceWidth, sourceHeight));
  let width = Math.max(1, Math.round(sourceWidth * initialScale));
  let height = Math.max(1, Math.round(sourceHeight * initialScale));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('CANVAS_UNSUPPORTED');

  let blob!: Blob;
  while (true) {
    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);
    for (let quality = 0.92; quality >= MIN_IMAGE_QUALITY; quality -= 0.05) {
      blob = await canvasBlob(canvas, quality);
      if (blob.size <= MAX_IMAGE_BYTES) break;
    }
    if (blob.size <= MAX_IMAGE_BYTES) break;
    width = Math.max(1, Math.round(width * 0.8));
    height = Math.max(1, Math.round(height * 0.8));
  }
  if ('close' in image && typeof image.close === 'function') image.close();
  const baseName = sourceFile.name.replace(/\.[^.]+$/, '') || 'receipt';
  return { file: new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: sourceFile.lastModified }), resized: true };
}
