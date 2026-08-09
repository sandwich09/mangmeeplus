import { randomUUID } from 'node:crypto';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png',
  'application/pdf',
]);

const ALLOWED_EXTENSIONS_BY_MIME_TYPE: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
};

const CANONICAL_EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

const EXPENSE_ATTACHMENT_PURPOSES = new Set([
  'expense.receipt.primary',
  'expense.receipt.supporting',
  'expense.payment.evidence',
  'expense.review.evidence',
  'expense.signature.asset',
]);

export function isAllowedAttachmentTarget(targetType: string, purpose: string): boolean {
  return targetType === 'expense.record' && EXPENSE_ATTACHMENT_PURPOSES.has(purpose);
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

export function validateAttachmentMeta(mimeType: string, byteSize: number, maxBytes = MAX_ATTACHMENT_BYTES): string | null {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return `MIME type "${mimeType}" is not allowed.`;
  }
  if (byteSize <= 0 || byteSize > Math.min(MAX_ATTACHMENT_BYTES, maxBytes)) {
    return `File size must be between 1 byte and ${Math.min(MAX_ATTACHMENT_BYTES, maxBytes)} bytes.`;
  }
  return null;
}

export function validateAttachmentFileName(fileName: unknown, mimeType: string): string | null {
  const extension = typeof fileName === 'string'
    ? /^.+\.([^.]+)$/.exec(fileName.trim())?.[1]?.toLowerCase()
    : undefined;
  const allowedExtensions = ALLOWED_EXTENSIONS_BY_MIME_TYPE[mimeType];
  if (!extension || !allowedExtensions?.includes(extension)) {
    return 'File extension does not match the declared MIME type.';
  }
  return null;
}

export function detectAttachmentMimeType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    return 'image/jpeg';
  }
  return null;
}

export function normalizeAttachmentMimeType(declaredMimeType: string | null | undefined, bytes: Buffer): string {
  const declared = declaredMimeType?.split(';')[0]?.trim().toLowerCase();
  if (declared === 'image/jpg') return 'image/jpeg';
  if (declared && declared !== 'application/octet-stream') return declared;
  return detectAttachmentMimeType(bytes) ?? declared ?? 'application/octet-stream';
}

export function canonicalAttachmentExtension(mimeType: string): string | null {
  return CANONICAL_EXTENSION_BY_MIME_TYPE[mimeType] ?? null;
}

// CR-10: a scanned receipt is one compressed image stream per page, and compressed bytes are
// statistically random — so short needles like `/js` hit by chance. Measured on well-formed
// PDFs, the old whole-stream scan quarantined 13% of 0.5 MB scans and 78% of 10 MB ones,
// permanently and behind a HIGH security alert. Strip stream payloads and match only the object
// structure a reader parses for behaviour. Detection is unchanged in practice: active content
// only works from a dictionary, and anything hidden inside a compressed stream was already
// unreadable to a regex. Anchored on `>>` so the literal word "stream" cannot blind the scan.
const PDF_STREAM_PAYLOAD = />>\s*stream\b[\s\S]*?endstream/g;

export function inspectAttachmentBytes(mimeType: string, bytes: Buffer): string | null {
  if (detectAttachmentMimeType(bytes) !== mimeType) return 'File signature does not match the declared MIME type.';

  const ascii = bytes.toString('latin1').toLowerCase();
  if (ascii.includes('eicar-standard-antivirus-test-file')) return 'Malware test signature detected.';

  const isPdf = mimeType === 'application/pdf';
  const scanned = isPdf ? ascii.replace(PDF_STREAM_PAYLOAD, '>>') : ascii;
  if (/<script\b|<svg\b|javascript:|vbscript:|data:text\/html/.test(scanned)) {
    return 'Active content is not allowed in attachments.';
  }
  if (isPdf && /\/(javascript|js|openaction|launch|richmedia|embeddedfile|xfa)\b/.test(scanned)) {
    return 'Active PDF content is not allowed.';
  }
  const pdfObjectCount = isPdf ? (scanned.match(/\bobj\b/g) ?? []).length : 0;
  if (pdfObjectCount > 100_000) return 'PDF object count exceeds the parser safety limit.';
  return null;
}

// Decides the Content-Type only; `downloadContentDisposition` decides attachment vs inline.
// Uploads never accept SVG (see ALLOWED_MIME_TYPES + inspectAttachmentBytes), so image/svg+xml
// here can only be a system-generated substitute-receipt artifact — and SVG is never
// content-sniffed by browsers, so without the real type <img> shows a broken icon.
const INLINE_DOWNLOAD_MIME_TYPES = /^(?:image\/(?:png|jpeg|svg\+xml)|application\/pdf)$/;

export function inlineDownloadContentType(mimeType: string | null | undefined): string {
  return mimeType && INLINE_DOWNLOAD_MIME_TYPES.test(mimeType) ? mimeType : 'application/octet-stream';
}

// Narrower than the Content-Type list on purpose. Chrome's ORB blocks an `attachment` response
// loaded as an <img>, so a preview caller may ask for `inline` — but only for the types a browser
// renders as a picture, never for a type it might sniff as a document. SVG is excluded even though
// it is image/*: an SVG opened inline is a document that runs its own script, on the storage
// origin. Substitute-receipt artifacts are the only SVGs we hold and they still download fine.
const INLINE_DISPOSITION_MIME_TYPES = /^(?:image\/(?:png|jpeg)|application\/pdf)$/;

/** The `Content-Disposition` a signed download carries. `attachment` unless inline is asked for AND safe. */
export function downloadContentDisposition(input: {
  disposition?: 'inline' | 'attachment';
  mimeType?: string | null;
  fileName?: string | null;
}): string {
  const type = input.disposition === 'inline' && input.mimeType && INLINE_DISPOSITION_MIME_TYPES.test(input.mimeType)
    ? 'inline'
    : 'attachment';
  return `${type}; filename="${(input.fileName ?? 'download').replace(/["\r\n]/g, '_')}"`;
}

export function generateObjectKey(companyId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `pending/${companyId}/${randomUUID()}_${safe}`;
}

export function generateImmutableObjectKey(companyId: string, checksumSha256: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `evidence/${companyId}/${checksumSha256}/${randomUUID()}_${safe}`;
}
