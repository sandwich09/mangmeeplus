import { ATTACHMENT_UPLOAD_ACCEPT, IMAGE_UPLOAD_ACCEPT, attachmentMimeTypeForFileName, classifyUploadSourceFile } from '@/common/files/upload-file.logic';
import {
  isAiBudgetRefusalCode,
  isReceiptOcrRetryableFailure,
  type ExpenseExtractionResult,
  type ReceiptOcrFieldResult,
} from '@watchdog-bms/contracts';

// The budget a re-encoded photo is compressed into. Every server-side limit on this path is
// 10 MB — `UPLOAD_MAX_BYTES` (packages/config), the attachment gate, and `MAX_EXTRACTION_BYTES`
// in expense-extraction.use-case.ts — so the old 2 MB was a client-only ceiling five times
// tighter than anything that required it, and a phone photo is the only input that ever meets
// it (a PDF returns early, uncompressed, which is why desktop scans were never affected).
// A receipt's เลขประจำตัวผู้เสียภาษี is its smallest print, so it is the first thing lost when
// this budget forces the quality floor — and the OCR grounding check then drops an unverifiable
// tax id rather than guessing, which is why it came back empty instead of wrong.
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
// Long edge of a re-encoded photo, and the floor the JPEG quality ladder stops at. Both are set
// for reading 13 small digits, not for looking at a picture: below ~0.7 the artefacts close the
// counters of 6/8/9 and merge adjacent digits.
const MAX_IMAGE_EDGE_PX = 3200;
const MIN_IMAGE_QUALITY = 0.72;
export const RECEIPT_UPLOAD_ACCEPT = ATTACHMENT_UPLOAD_ACCEPT;
export const SIGNATURE_UPLOAD_ACCEPT = IMAGE_UPLOAD_ACCEPT;

export type UploadFileKind = 'image' | 'pdf' | 'heic' | 'unsupported';

export function shouldShowExtractionNotice(notice: { tone: 'info' | 'error'; persistent?: boolean } | null | undefined, hasAiSummary: boolean): boolean {
  return Boolean(notice && (notice.tone === 'error' || notice.persistent === true || !hasAiSummary));
}

/** Lost HTTP responses reuse the idempotency key; a received provider failure is a fresh attempt. */
export function expenseExtractionRetryMode(
  result: ExpenseExtractionResult | null,
): 'same_request' | 'new_request' | 'none' {
  if (result === null) return 'same_request';
  if (isReceiptOcrRetryableFailure(result)) return 'new_request';
  return 'none';
}

export const expenseExtractionRetryRequestId = (
  mode: Exclude<ReturnType<typeof expenseExtractionRetryMode>, 'none'>,
  originalRequestId: string,
  freshRequestId: string,
): string => mode === 'same_request' ? originalRequestId : freshRequestId;

export type ExpenseExtractionAttempt = { requestId: string; attachmentId: string | null };
type ExpenseExtractionRecoveryDetail = {
  aiVerificationSummaryJson: Record<string, unknown> | null;
  attachments: ReadonlyArray<{ id: string; purpose: string; status: string }>;
};

type ExpenseExtractionAttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const expenseExtractionAttemptKey = (companyId: string, expenseId: string) =>
  `expense-extraction-attempt:${companyId}:${expenseId}`;

export function availableExpenseSessionStorage(
  source: { readonly sessionStorage: ExpenseExtractionAttemptStorage } | undefined,
): ExpenseExtractionAttemptStorage | undefined {
  try { return source?.sessionStorage; } catch { return undefined; }
}

export function readExpenseExtractionAttempt(
  storage: ExpenseExtractionAttemptStorage | undefined,
  companyId: string,
  expenseId: string,
  attachmentId: string | null,
): ExpenseExtractionAttempt | null {
  if (!storage) return null;
  try {
    const raw = JSON.parse(storage.getItem(expenseExtractionAttemptKey(companyId, expenseId)) ?? 'null') as Record<string, unknown> | null;
    return raw
      && typeof raw['requestId'] === 'string'
      && raw['requestId'].length > 0
      && raw['attachmentId'] === attachmentId
      ? { requestId: raw['requestId'], attachmentId }
      : null;
  } catch { return null; }
}

export function writeExpenseExtractionAttempt(
  storage: ExpenseExtractionAttemptStorage | undefined,
  companyId: string,
  expenseId: string,
  attempt: ExpenseExtractionAttempt | null,
): void {
  if (!storage) return;
  try {
    const key = expenseExtractionAttemptKey(companyId, expenseId);
    if (attempt) storage.setItem(key, JSON.stringify(attempt));
    else storage.removeItem(key);
  } catch { /* storage can be disabled */ }
}

export function activePrimaryReceiptAttachmentId(
  attachments: ExpenseExtractionRecoveryDetail['attachments'],
): string | null {
  return attachments.find((attachment) =>
    attachment.purpose === 'expense.receipt.primary' && attachment.status === 'ACTIVE')?.id ?? null;
}

/** Only the exact successful request against the still-current receipt can resolve a lost response. */
export function recoveredExpenseExtraction(
  detail: ExpenseExtractionRecoveryDetail,
  attempt: ExpenseExtractionAttempt,
): ExpenseExtractionResult | null {
  const summary = detail.aiVerificationSummaryJson;
  // Spec §9.1: this attempt's own stored money refusal IS its answer. Replaying it must never ask
  // the gate again — a second request would be priced against the CURRENT budget and could report
  // success for an attempt that was refused. Checked before the success path and against its own
  // ids, because the top-level extraction fields belong to whichever read last succeeded.
  const refusal = summary?.['aiBudgetRefusal'] as
    { errorCode?: unknown; budgetScope?: unknown; extractionRequestId?: unknown; extractionAttachmentId?: unknown } | undefined;
  if (
    refusal
    && refusal.extractionRequestId === attempt.requestId
    && refusal.extractionAttachmentId === attempt.attachmentId
    && activePrimaryReceiptAttachmentId(detail.attachments) === attempt.attachmentId
    && isAiBudgetRefusalCode(typeof refusal.errorCode === 'string' ? refusal.errorCode : undefined)
  ) {
    return {
      status: 'failed',
      errorCode: refusal.errorCode as string,
      ...(refusal.budgetScope === 'TOTAL' || refusal.budgetScope === 'CHAT' || refusal.budgetScope === 'OCR'
        ? { budgetScope: refusal.budgetScope }
        : {}),
    };
  }
  if (
    summary?.['status'] !== 'OCR_EXTRACTED_NEEDS_REVIEW'
    || summary['extractionRequestId'] !== attempt.requestId
    || summary['extractionAttachmentId'] !== attempt.attachmentId
    || activePrimaryReceiptAttachmentId(detail.attachments) !== attempt.attachmentId
  ) return null;
  const recognized = summary['recognizedFields'];
  const fields = recognized && typeof recognized === 'object' && !Array.isArray(recognized)
    ? { ...(recognized as ReceiptOcrFieldResult) }
    : undefined;
  const missingFields = Array.isArray(summary['missingFields'])
    ? summary['missingFields'].filter((field): field is string => typeof field === 'string')
    : undefined;
  if (fields && missingFields) fields.missingFields = missingFields;
  return { status: 'ok', ...(fields ? { fields } : {}), ...(missingFields ? { missingFields } : {}) };
}

export function expenseExtractionResponseIsUnknown(error: unknown): boolean {
  const failure = error as { kind?: unknown; status?: unknown; statusCode?: unknown } | null;
  const status = typeof failure?.statusCode === 'number'
    ? failure.statusCode
    : typeof failure?.status === 'number' ? failure.status : null;
  return failure?.kind === 'network_error' || status === null || status === 408 || status >= 500;
}

/**
 * Recover an unknown response from the saved expense before retrying the same request id. A second
 * read covers the ordinary race where the first HTTP connection died while the server was writing.
 */
export async function requestExpenseExtractionWithRecovery<T extends ExpenseExtractionRecoveryDetail>(input: {
  attempt: ExpenseExtractionAttempt;
  request: (requestId: string) => Promise<ExpenseExtractionResult>;
  read: () => Promise<T>;
  wait: () => Promise<void>;
  resume?: boolean;
}): Promise<{ result: ExpenseExtractionResult; recoveredDetail: T | null; pending: boolean }> {
  const recover = async () => {
    const detail = await input.read().catch(() => null);
    const result = detail ? recoveredExpenseExtraction(detail, input.attempt) : null;
    return result && detail ? { result, recoveredDetail: detail, pending: false } : null;
  };
  const settleResult = async (result: ExpenseExtractionResult) => {
    if (result.status !== 'failed' || result.errorCode !== 'OCR_REQUEST_ALREADY_ADMITTED') {
      return { result, recoveredDetail: null, pending: false };
    }
    const recovered = await recover();
    return recovered ?? { result, recoveredDetail: null, pending: true };
  };
  if (input.resume) {
    const recovered = await recover();
    if (recovered) return recovered;
  }
  try {
    return settleResult(await input.request(input.attempt.requestId));
  } catch (error) {
    if (!expenseExtractionResponseIsUnknown(error)) throw error;
    const immediate = await recover();
    if (immediate) return immediate;
    await input.wait();
    const settled = await recover();
    if (settled) return settled;
    try {
      return settleResult(await input.request(input.attempt.requestId));
    } catch (retryError) {
      if (!expenseExtractionResponseIsUnknown(retryError)) throw retryError;
      const recovered = await recover();
      if (recovered) return recovered;
      throw retryError;
    }
  }
}

/**
 * P10-L §15.1: the shop's monthly AI image-read ceiling, latched on the upload panel.
 *
 * The 409 body carries the server's `monthKey`, but `mapResponseToApiError` keeps only `code`, so
 * the latch stamps the Bangkok month itself — the same `Asia/Bangkok` civil day the date field
 * already defaults to, and the same month the server counts in.
 */
export type ReceiptQuotaLatch = { monthKey: string; message: string };

export const RECEIPT_QUOTA_ERROR_CODE = 'receipt_quota_exceeded';

/** `YYYY-MM` in the company timezone, from the civil date this screen already uses. */
export const bangkokMonthKey = (today: string): string => today.slice(0, 7);

/**
 * True while the latch still speaks for the month on the clock. A latch from last month is stale —
 * the ceiling resets on the 1st, so the banner must clear and the button must come back without a
 * reload. Anything unparseable is treated as stale rather than blocking the shop forever.
 */
export function isReceiptQuotaBlocked(latch: ReceiptQuotaLatch | null, today: string): boolean {
  return latch !== null && latch.monthKey === bangkokMonthKey(today);
}

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
  return classifyUploadSourceFile({ name, type });
}

export function classifySignatureUploadFile(name: string, type: string): Exclude<UploadFileKind, 'pdf'> {
  const kind = classifyUploadSourceFile({ name, type }, 'image');
  return kind === 'pdf' ? 'unsupported' : kind;
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

async function prepareUploadFile(file: File, kind: UploadFileKind): Promise<{ file: File; resized: boolean }> {
  if (kind === 'unsupported') throw new Error('UNSUPPORTED_UPLOAD_FILE');
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  const inferredMimeType = attachmentMimeTypeForFileName(file.name)
    ?? (extension === 'jpe' ? 'image/jpeg'
      : extension === 'gif' ? 'image/gif'
        : extension === 'heic' ? 'image/heic' : 'image/heif');
  const sourceMimeType = file.type === 'image/jpg' ? 'image/jpeg' : (file.type || inferredMimeType);
  const sourceName = sourceMimeType === 'image/jpeg' && extension === 'jpe'
    ? file.name.replace(/\.jpe$/i, '.jpg')
    : file.name;
  const sourceFile = sourceMimeType === file.type && sourceName === file.name
    ? file
    : new File([file], sourceName, { type: sourceMimeType, lastModified: file.lastModified });
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

export function prepareReceiptFile(file: File): Promise<{ file: File; resized: boolean }> {
  return prepareUploadFile(file, classifyUploadFile(file.name, file.type));
}

export function prepareSignatureFile(file: File): Promise<{ file: File; resized: boolean }> {
  return prepareUploadFile(file, classifySignatureUploadFile(file.name, file.type));
}
